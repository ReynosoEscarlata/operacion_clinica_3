# Runbook — Saturación de Fargate (`clinica-<servicio>-high-cpu`)

**Alcance:** 6 alarmas (una por servicio: auth, appointments, doctors, payments, notifications,
gateway — ver `infra/lib/constructs/clinic-service.ts`). Existen desde Fase 2 (threshold 85% CPU,
3 períodos de evaluación); este runbook es retroactivo (Fase 6, ADR-017). Fase 6 agrega también
memoria y "max-capacity alcanzado" (autoscaling ya en su tope) como señales relacionadas,
cubiertas acá.

**Nunca ejecutado por Claude Code.**

---

## Síntoma

Mensaje en `clinica-<env>-operational-alerts`: CPU de un servicio > 85% sostenido 3 períodos.

## Diagnóstico

1. `aws ecs describe-services --cluster clinica-<env>-cluster --services <servicio>` — cuántas
   tareas corriendo vs. `desiredCount`/`maxCapacity` (ver `config.fargate` en
   `infra/config/environments.ts`).
2. Dashboard `clinica-<env>-plataforma` (CloudWatch) — CPU del servicio en la ventana de tiempo, y
   si el autoscaling ya reaccionó (más tareas corriendo que `desiredCount` base).
3. Si es `appointments`: revisa también la métrica de profundidad de
   `appointments-domain-events` — el autoscaling de este servicio también escala por profundidad
   de cola (`QueueDepthScaling`, ver `clinic-service.ts`), no solo CPU.
4. `docs/runbooks/consultas-logs-insights.md` — busca un patrón de tráfico anómalo (un tenant
   con volumen fuera de lo normal, un bug de loop/retry sin backoff) vs. crecimiento orgánico.

## Decisión

- ¿El autoscaling ya está agregando tareas y el máximo (`maxCapacity`) no se alcanzó? → Esperar,
  es el comportamiento esperado; la alarma es informativa, no requiere acción manual.
- ¿Ya se alcanzó `maxCapacity` y sigue saturado? → Requiere subir `maxCapacity`/`desiredCount` en
  `infra/config/environments.ts` (cambio de config, `cdk deploy`) — **verificar contra
  `docs/cost/cost-model.md` antes**, un cambio de talla de Fargate/RDS es justo el tipo de cambio
  que ese documento pide re-verificar.
- ¿Es un tenant individual generando el volumen (no crecimiento agregado)? → Investigar si es
  tráfico legítimo (una clínica grande) o un bug/abuso (ver también
  `alarma-acceso-cross-tenant.md` si hay indicios de enumeración).

## Pasos

```bash
# Ver el estado actual del servicio:
aws ecs describe-services --cluster clinica-<env>-cluster --services <servicio> \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount}'

# Si hace falta escalar manualmente mientras se decide un cambio permanente:
aws ecs update-service --cluster clinica-<env>-cluster --service <servicio> --desired-count <N>
```

Cambio permanente: editar `config.fargate[servicio]` en `infra/config/environments.ts`,
`npx cdk diff -c env=<entorno>`, revisar, `npx cdk deploy` (ver `deploy-infra.md`).

## Verificación

- CPU vuelve por debajo del 85% sostenido.
- Si se escaló `maxCapacity`: confirmar en `cdk diff` que el cambio es exactamente el esperado
  (no arrastra otros cambios no relacionados).

## Comunicación

Si el cambio requiere subir la talla de RDS o Fargate de forma permanente, avisar antes de
desplegar a `staging`/`prod` — impacta el costo mensual proyectado en `cost-model.md`.

## Post-mortem

Si la causa fue un pico de tráfico legítimo (crecimiento de clínicas), actualizar
`docs/cost/cost-model.md` con el nuevo escenario. Si fue un bug (loop sin backoff, retry
agresivo), el fix debe incluir un test que lo cubra.
