# Runbook — Error rate 5xx (`clinica-<env>-<servicio>-error-rate-5xx`, `clinica-<env>-alb-5xx`, `clinica-<env>-alb-anomalia-trafico`)

**Alcance:** 6 alarmas de error rate (una por servicio, vía EMF — `infra/lib/stacks/observability-stack.ts`)
+ 2 alarmas del ALB (`clinica-<env>-alb-5xx` a nivel de balanceador, `clinica-<env>-gateway-error-rate-5xx`
a nivel de target — `infra/lib/stacks/edge-stack.ts`) + la alarma de anomalía de tráfico del ALB, que
enlaza acá porque una caída/pico de tráfico casi siempre coincide con un incidente de error rate.
Notifica a `clinica-<env>-operational-alerts`.

**Umbrales NO VERIFICADOS contra tráfico real** (no existe todavía, ver `docs/baseline-challenge-4.md`)
— valores de arranque, a recalibrar con datos de producción.

**Nunca ejecutado por Claude Code.**

---

## Síntoma

- Error rate EMF de un servicio sobre 1% sostenido por 3 períodos de 5 minutos, **o**
- ≥10 respuestas 5xx del ALB (o del target group del gateway) en 5 minutos, **o**
- Volumen de requests del ALB fuera de la banda esperada (anomaly detection).

## Diagnóstico

1. Identificar el servicio por el nombre de la alarma. Si es `alb-5xx` (nivel ALB, no de target),
   revisar primero si es el WAF bloqueando de más (ver `RateLimitPorIp` en `edge-stack.ts`) antes de
   asumir que es un error de aplicación.
2. Drill-down por servicio y ventana de tiempo (`consultas-logs-insights.md`, sección "Error rate /
   latencia por servicio"):
   ```
   filter Service = "<servicio>"
   | stats sum(ErrorCount) as errores, count(*) as total, avg(RequestLatency) as latenciaPromedio by bin(5m)
   ```
3. Con el rango de tiempo del pico de errores, buscar el `traceId` de una request fallida específica
   y abrir X-Ray → Traces para ver la traza completa (qué servicio downstream, si lo hay, fue el que
   falló).
4. Revisar CloudWatch Logs del servicio en la misma ventana — buscar excepciones no capturadas,
   timeouts hacia Doctors/Payments (dependencias síncronas, ADR-001), o errores de conexión a RDS.

## Decisión

- **Errores 5xx concentrados en un solo endpoint** → probable bug de aplicación en ese endpoint
  específico — no es una caída generalizada, no requiere rollback del servicio completo.
- **Errores 5xx distribuidos en todos los endpoints de un servicio** → probable problema de
  infraestructura (RDS caído/lento, memoria agotada, deploy roto) — revisar `alarma-rds.md` y
  `alarma-saturacion-fargate.md` en paralelo.
- **5xx del ALB sin 5xx correspondiente en el target** → el problema está en el ALB/WAF, no en el
  servicio (ej. WAF bloqueando tráfico legítimo, timeout del listener).
- **Anomalía de tráfico sin error rate elevado** → puede ser tráfico legítimo inusual (lanzamiento,
  campaña) o el inicio de un ataque — cruzar con IPs de origen en los access logs del ALB antes de
  decidir.

## Pasos

```bash
# Ver el estado actual del servicio ECS:
aws ecs describe-services --cluster clinica-<env>-cluster --services <servicio>

# Si el error coincide con un deploy reciente, el circuit breaker de ECS (circuitBreaker.rollback,
# ver clinic-service.ts) ya debería haber revertido automáticamente -- confirmar:
aws ecs describe-services --cluster clinica-<env>-cluster --services <servicio> \
  --query 'services[0].deployments'
```

Si el circuit breaker no revirtió solo y el deploy es la causa confirmada, forzar un rollback manual
a la imagen anterior en ECR y `force-new-deployment`.

## Verificación

- Error rate EMF vuelve por debajo del 1% por al menos 3 períodos consecutivos.
- `clinica-<env>-alb-5xx`/`gateway-error-rate-5xx` vuelven a `OK`.
- Ninguna traza nueva en X-Ray muestra el mismo error tras el fix.

## Comunicación

Si el error rate afectó a pacientes intentando reservar/pagar una cita (endpoints públicos), avisar
en el canal del equipo con el rango horario afectado — puede requerir comunicación proactiva a
clínicas si el volumen fue alto.

## Post-mortem

Si la causa raíz fue un bug de aplicación, el fix debe incluir un test de regresión que reproduzca
el escenario exacto. Si fue infraestructura (RDS, memoria), documentar el ajuste de sizing en
`infra/config/environments.ts` con el razonamiento, no solo el número nuevo.
