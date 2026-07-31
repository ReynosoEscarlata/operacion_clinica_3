# Runbooks — índice

Todo runbook sigue el mismo formato de 7 secciones (`deploy-infra.md` fue el primero en
establecerlo): síntoma → diagnóstico → decisión → pasos → verificación → comunicación →
post-mortem. Escrito para ser ejecutado por alguien que no lo escribió.

Desde Fase 6 (ADR-017), toda alarma de CloudWatch lleva un `alarmDescription` con
`Runbook: docs/runbooks/<archivo>.md` — el construct `infra/lib/constructs/alarm-with-runbook.ts`
lo exige como prop obligatorio, y `infra/test/alarmas-tienen-runbook.test.ts` falla si el archivo
referenciado no existe en disco. Un runbook que no existe es el mismo problema que una alarma sin
runbook.

## Índice `alarmName` → runbook

| Alarma (nombre en CloudWatch) | Runbook | Desde |
|---|---|---|
| `clinica-<env>-dlq-<cola>-no-vacia` (×5) | [`alarma-dlq-no-vacia.md`](./alarma-dlq-no-vacia.md) | Fase 2 (retroactivo) |
| `clinica-<servicio>-high-cpu` (×6) | [`alarma-saturacion-fargate.md`](./alarma-saturacion-fargate.md) | Fase 2 (retroactivo) |
| `clinica-<env>-gateway-unhealthy-targets` | [`alarma-targets-no-saludables.md`](./alarma-targets-no-saludables.md) | Fase 2 (retroactivo) |
| `clinica-<env>-<servicio>-error-rate-5xx`, `clinica-<env>-alb-5xx` | [`alarma-error-rate-5xx.md`](./alarma-error-rate-5xx.md) | Fase 6 |
| `clinica-<env>-<servicio>-latencia-p95`, `clinica-<env>-alb-latencia-p95` | [`alarma-latencia-p95.md`](./alarma-latencia-p95.md) | Fase 6 |
| `clinica-<env>-rds-<servicio>-*` | [`alarma-rds.md`](./alarma-rds.md) | Fase 6 |
| `clinica-<env>-cross-tenant-access-denied` | [`alarma-acceso-cross-tenant.md`](./alarma-acceso-cross-tenant.md) | Fase 6 |
| `clinica-<env>-monthly` (Budget), Cost Anomaly Detection | [`alarma-presupuesto-y-anomalia-de-costo.md`](./alarma-presupuesto-y-anomalia-de-costo.md) | Fase 2 (Budget, retroactivo) + Fase 6 (Anomaly) |
| — (consulta ad-hoc, no alarma) | [`consultas-logs-insights.md`](./consultas-logs-insights.md) | Fase 6 |

## Destinos de notificación (SNS)

- `clinica-<env>-operational-alerts` — guardia (5xx, latencia, DLQ, Fargate, RDS).
- `clinica-<env>-security-alerts` — acceso cross-tenant, fallo de escritura del audit log
  (Fase 5). Audiencia distinta: un evento acá es un posible incidente LFPDPPP, no un ticket.
- `clinica-<env>-budget-alerts` / `clinica-<env>-cost-alerts` (este último en `us-east-1`, ver
  `infra/lib/stacks/cost-stack.ts`) — quien controla el gasto, no la guardia técnica.
