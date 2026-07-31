# Runbook — Presupuesto y anomalía de costo (`clinica-<env>-monthly`, Cost Anomaly Detection)

**Alcance:** `infra/lib/stacks/cost-stack.ts`, pinneado a `us-east-1` (ni `AWS::Budgets::Budget` ni
Cost Anomaly Detection existen en `mx-central-1`, ADR-010/ADR-017). Notifica a
`clinica-<env>-cost-alerts` (SNS en us-east-1, propio de este stack — no el
`operationalAlarmTopic` de `mx-central-1`).

**Presupuesto (`clinica-<env>-monthly`)**: existe desde Fase 2 (retroactivo — nunca tuvo runbook
hasta ahora). **Cost Anomaly Detection** (2 monitores + 1 suscripción) es nuevo de Fase 6.

**Nunca ejecutado por Claude Code.**

---

## Síntoma

- **Budget**: notificación ACTUAL (80% o 100% del límite mensual) o FORECASTED (100% proyectado
  antes de fin de mes) — ver `budgetLimitUsd` por entorno en `infra/config/environments.ts`.
- **Cost Anomaly Detection**: un gasto que se desvía significativamente del patrón histórico, ya sea
  por servicio de AWS específico (monitor DIMENSIONAL) o por el total etiquetado
  `Environment=<env>` (monitor CUSTOM) — umbral NO VERIFICADO
  (`costAnomalyThresholdUsd`, ver environments.ts).

## Diagnóstico

1. Abrir Cost Explorer (consola, `us-east-1` o el selector de región no aplica — Cost Explorer es
   global) y filtrar por el tag `Environment=<env>` para ver el desglose de gasto reciente.
2. Para una anomalía específica: Billing and Cost Management → Cost Anomaly Detection → revisar el
   detalle de la anomalía (qué servicio/dimensión, cuánto por encima de lo esperado, desde cuándo).
3. Cruzar con cambios de infraestructura recientes: ¿hubo un deploy que subió `desiredCount`/tamaño
   de instancia en `infra/config/environments.ts`? ¿Se agregó un servicio nuevo? ¿Un NAT Gateway
   quedó corriendo de más (natGateways en environments.ts)?
4. Si el presupuesto se disparó pero Cost Anomaly Detection no marcó nada raro, es crecimiento
   orgánico esperado (más tráfico, más tenants) — revisar si `budgetLimitUsd` del entorno sigue
   siendo realista, no necesariamente un problema a resolver.

## Decisión

- **Anomalía + cambio de infra reciente identificado como causa** → si fue un error (ej. tamaño de
  instancia subido sin querer, recurso no destruido en dev), corregir la configuración.
- **Anomalía sin cambio de infra identificable** → investigar más a fondo antes de asumir que es
  normal — podría ser un recurso huérfano (algo que `cdk destroy` no limpió, ej. un NAT Gateway o
  una instancia RDS con `removalPolicy: RETAIN` de un stack ya no usado).
- **Presupuesto al 80-100% por crecimiento orgánico** → no es una alarma de "algo se rompió", es una
  señal para revisar si el `budgetLimitUsd` del entorno necesita ajustarse (decisión humana, no
  automática).

## Pasos

```bash
# Recursos con removalPolicy RETAIN que sobrevivieron a un cdk destroy de un stack viejo
# (candidato típico de gasto huérfano) -- listar RDS/buckets con el prefijo del proyecto:
aws rds describe-db-instances --query "DBInstances[?contains(DBInstanceIdentifier, 'clinica-')].DBInstanceIdentifier"
aws s3 ls | grep clinica-
```

Si se confirma un recurso huérfano, coordinar su borrado manual (fuera de CDK, ya que no está en
ningún stack activo) con el humano responsable del proyecto.

## Verificación

- El gasto vuelve a la tendencia histórica esperada (Cost Explorer).
- La alarma de Budget vuelve por debajo del umbral que la disparó el mes siguiente.

## Comunicación

Cualquier ajuste de `budgetLimitUsd` o de sizing en `infra/config/environments.ts` que resulte de
este runbook requiere aprobación humana antes de aplicarse (ver CLAUDE.md, sección de guardrails de
este proyecto) — nunca un cambio silencioso solo para silenciar la alarma.

## Post-mortem

Si la causa fue un recurso huérfano, documentar en `docs/backlog-deuda.md` cualquier gap del
proceso de `cdk destroy` que lo permitió (ej. un `removalPolicy: RETAIN` que debería haber sido
`DESTROY` en dev).
