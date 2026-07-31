# Reporte de costo por tenant — método

**Fase 6 (ADR-017).** Ejecutado por `scripts/costo-por-tenant.mjs` — **nunca por Claude Code**
(guardrail del repo: ningún script que llame a la API de AWS/Cost Explorer se ejecuta desde una
sesión de Claude Code, solo se genera el código).

## Por qué es una aproximación, no chargeback

El modelo de este sistema es **shared-DB + RLS** (ADR-005): 5 Postgres compartidos entre todos los
tenants de un mismo servicio, no una base de datos por clínica. Eso significa que **no existe** un
recurso de AWS individual atribuible a un tenant específico — una instancia RDS, una tarea Fargate,
o un NAT Gateway sirven a todos los tenants de un entorno a la vez. Cualquier número de "costo de
este tenant" es necesariamente una **asignación proporcional estimada**, no una medición directa
como la que daría un modelo db-per-tenant (deliberadamente descartado en ADR-005 por costo —
ver `cost-model.md` §4.1, hasta 68.9x más caro a 1000 clínicas).

Este documento es útil para: comparar el peso relativo entre tenants, detectar un tenant
anómalamente costoso (ej. mucho más tráfico del esperado), y como insumo de un modelo de precios
futuro — **no** para facturar a un tenant un monto exacto y defendible como costo real de AWS.

## Método

### 1. Costo real por componente (`ClinicService`/`Component`)

Fuente: AWS Cost Explorer, filtrado por los tags `ClinicService` (por servicio: auth, appointments,
doctors, payments, notifications, gateway — aplicados en `infra/lib/stacks/compute-stack.ts` y
`database-stack.ts`) y `Component` (por stack: network, database, messaging, etc. — aplicados en
`infra/lib/build-app.ts`), para el rango de fechas del reporte.

Esto separa el costo en dos categorías:
- **Atribuible a un servicio** (Fargate + RDS de ese servicio, vía `ClinicService`) — se reparte
  proporcionalmente entre tenants según su share de tráfico de ESE servicio (paso 2).
- **Costo fijo de plataforma** (NAT Gateway, ALB, WAF, Cognito, CloudTrail — vía `Component`, sin
  `ClinteroService` porque son compartidos sin distinción de servicio) — se reparte **en partes
  iguales** entre tenants activos en el período (no hay una señal de tráfico para prorratear un NAT
  Gateway compartido de forma más precisa que esa).

### 2. Share de tráfico por tenant (CloudWatch Logs Insights)

Fuente: el campo `tenantId` que el mixin de Pino de cada servicio ya inyecta en cada línea de log
(Fase 6, Ola 1 — `services/*/src/lib/logger.ts`), consultado con la misma query que
`consultas-logs-insights.md` documenta para este propósito:

```
fields tenantId
| filter ispresent(tenantId)
| stats count(*) as requests by tenantId
```

Ejecutada por servicio (`/clinica/<servicio>`) para el mismo rango de fechas que el reporte de Cost
Explorer. El share de un tenant en un servicio = `requests del tenant / requests totales del
servicio en el período`.

**Limitación explícita:** esto mide volumen de *requests*, no costo real de cómputo por request
(una query lenta de un tenant pesa más en CPU/RDS que una rápida de otro, y esto no lo captura). Es
la mejor señal disponible sin instrumentación adicional (ej. tracking de duración de CPU por
tenant, que no existe) — se declara como aproximación, no se pretende mayor precisión de la que da.

### 3. Asignación final

```
costo_estimado(tenant, servicio) = costo_real(servicio, ClinicService) × share_tráfico(tenant, servicio)
costo_estimado(tenant, plataforma) = costo_fijo_plataforma / cantidad_de_tenants_activos
costo_estimado(tenant) = Σ costo_estimado(tenant, servicio) por los 6 servicios + costo_estimado(tenant, plataforma)
```

## Qué NO hace este reporte

- No incluye impuestos, descuentos por compromiso de uso (Savings Plans/Reserved Instances, si se
  contrataran a futuro), ni soporte de AWS.
- No prorratea Secrets Manager, Cost Explorer/Anomaly Detection mismos, ni el costo de este propio
  script (todos fijos de plataforma, incluidos en el reparto igualitario del paso 3).
- No distingue entre un tenant en tier gratuito/promocional y uno de pago — eso es una decisión de
  producto/facturación fuera del alcance de este documento.

## Ejecución

```bash
cd scripts
node costo-por-tenant.mjs --env dev --desde 2026-07-01 --hasta 2026-07-31
```

Requiere credenciales de AWS con permisos de lectura sobre Cost Explorer (`ce:GetCostAndUsage`,
región `us-east-1` — API global) y CloudWatch Logs Insights (`logs:StartQuery`/`GetQueryResults`)
para los 6 log groups `/clinica/<servicio>`. Ver `scripts/costo-por-tenant.mjs` para el detalle de
implementación y las banderas soportadas.
