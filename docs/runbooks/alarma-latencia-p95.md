# Runbook — Latencia p95 (`clinica-<env>-<servicio>-latencia-p95`, `clinica-<env>-alb-latencia-p95`)

**Alcance:** 6 alarmas de latencia p95 (una por servicio, vía EMF `RequestLatency` —
`infra/lib/stacks/observability-stack.ts`) + 1 alarma de latencia p95 del ALB a nivel del target
group del gateway (`infra/lib/stacks/edge-stack.ts`, `metricTargetResponseTime`). Notifica a
`clinica-<env>-operational-alerts`.

**Umbrales NO VERIFICADOS contra tráfico real** (no existe todavía) — 1000ms (servicios), 2s (ALB)
son valores de arranque razonables para una API REST con dependencias síncronas a otros servicios
(ADR-001-sync-vs-async.md), a recalibrar con datos de producción.

**Nunca ejecutado por Claude Code.**

---

## Síntoma

p95 de latencia de un servicio (o del ALB) sobre el umbral por 3 períodos de 5 minutos seguidos.

## Diagnóstico

1. Identificar el servicio por el nombre de la alarma.
2. Si es `appointments` (el único con dependencias síncronas reales, ADR-001: Doctors para slots,
   Payments para PaymentIntent/refund), sospechar primero de una de esas dos dependencias antes de
   asumir que el problema es local.
3. Con un `traceId` de una request lenta específica (buscar en Logs Insights por
   `Service = "<servicio>" | filter RequestLatency > <umbral_ms>`), abrir X-Ray → Traces — el mapa de
   servicio muestra exactamente qué segmento (propio o downstream síncrono) concentra el tiempo.
4. Si no hay dependencias síncronas de por medio (ej. `auth`, `doctors`), revisar:
   - `alarma-rds.md` — ¿la RDS del servicio está con CPU alta o `DBLoad` elevado?
   - Slow queries de Postgres (`consultas-logs-insights.md`, sección correspondiente) si
     `log_min_duration_statement` está activo.

## Decisión

- **Latencia alta concentrada en el segmento de una dependencia síncrona (Doctors/Payments desde
  Appointments)** → el problema real está en el servicio dependiente, no en el que disparó la
  alarma — repetir este runbook ahí.
- **Latencia alta en el propio segmento de la app, sin query lenta identificable** → sospechar CPU
  throttling de Fargate (ver `alarma-saturacion-fargate.md`) o contención de conexiones a RDS.
- **Latencia alta con una query específica repetida en el log de slow queries** → optimización de
  query/índice, no un problema de infraestructura.

## Pasos

```bash
# Confirmar si el servicio está bajo presión de CPU (Fargate throttles antes de fallar):
aws cloudwatch get-metric-statistics --namespace AWS/ECS --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=<servicio> Name=ClusterName,Value=clinica-<env>-cluster \
  --start-time <inicio> --end-time <fin> --period 300 --statistics Average
```

Si la causa es contención de conexiones a RDS, revisar `clinica-<env>-rds-<servicio>-conexiones` en
paralelo (`alarma-rds.md`) — puede requerir escalar el pool de conexiones de Prisma o el tamaño de
la instancia, no un fix de código.

## Verificación

- p95 vuelve por debajo del umbral por al menos 3 períodos consecutivos.
- Si la causa fue una dependencia síncrona, la latencia del servicio dependiente también volvió a
  niveles normales (revisar su propia alarma p95).

## Comunicación

Latencia alta sostenida en el flujo de reserva/pago (público, sin cuenta) afecta directamente la
experiencia del paciente — avisar en el canal del equipo aunque no haya errores 5xx todavía (la
latencia suele ser la señal temprana antes de que empiecen los timeouts).

## Post-mortem

Si la causa fue una query sin índice, el fix debe incluir la migración del índice + un test que
falle si la query vuelve a hacer un full scan (ej. `EXPLAIN ANALYZE` en un test de integración, si
la suite ya tiene ese patrón) — no solo el índice agregado sin verificación.
