# ADR-017: Observabilidad (trazas, métricas, dashboard ejecutivo) y control de costos

**Fecha:** 2026-07-31
**Estado:** Aceptado (2026-07-31)
**Decisor(es):** Ricardo Reynoso

## Contexto

Ningún ADR anterior (005–016) cubre trazas distribuidas, métricas custom, dashboards o detección
de anomalías de costo. `infra/lib/stacks/observability-stack.ts` quedó explícitamente incompleta
desde la Fase 2 ("sin métricas RED por tenant hasta que exista tenant_id") — con la tenancy y el
envelope de eventos ya resueltos (Fase 3, ADR-005/006/014), esta fase completa lo que el plan
maestro pide en su Fase 6: métricas RED por servicio y agregadas, logs estructurados con
retención por entorno, trazas distribuidas con `tenant_id`/`requestId`, un dashboard ejecutivo,
dashboards operativos con alarmas enlazadas a runbook, y control de costos (tags, budgets, Cost
Anomaly Detection, reporte por tenant).

El presupuesto ya es una restricción real, no hipotética: `docs/cost/cost-model.md` §3.5
comprometió **60 métricas custom** (~$18/mes) en el Gate 1, con solo ~$78/mes de margen en el
escenario de referencia de 10 clínicas. Cualquier diseño de métricas que escale con el número de
tenants o de rutas rompe ese número ya aprobado.

## Opciones consideradas

### 1. Trazas distribuidas
1. **AWS X-Ray** — nativo de AWS, sidecar de ECS soportado directo por CDK, sin dependencias de
   infraestructura nuevas más allá del propio sidecar.
   - Pros: consistente con el resto del stack (SQS/SNS/Cognito, todo AWS-nativo); más barato que
     correr infraestructura propia; el ALB ya inyecta `X-Amzn-Trace-Id` sin configuración.
   - Contras: lock-in a AWS; menos portable que un estándar abierto.
2. **OpenTelemetry + Collector** — vendor-neutral.
   - Pros: portabilidad, estándar de la industria.
   - Contras: requiere correr un Collector (sidecar o servicio propio) — más infra, más costo,
     más superficie de configuración para un presupuesto ya ajustado.
3. **Jaeger self-hosted** — descartado sin análisis detallado: implica correr y operar un backend
   de trazas completo, la opción más cara y con más superficie de las tres.

### 2. Métricas
1. **CloudWatch EMF (Embedded Metric Format), dimensiones `[Service, Environment]` únicamente**.
   - Pros: sin llamadas a `PutMetricData` (llega vía el log driver `awslogs` que ya existe, cero
     IAM nuevo); la línea de log hereda el contexto del logger (requestId/tenantId) sin
     instrumentación adicional; el desglose por tenant/ruta se hace gratis vía Logs Insights.
   - Contras: la extracción de métrica desde logs tiene un pequeño delay adicional vs.
     `PutMetricData` directo (irrelevante para dashboards, no para alarmas de latencia sub-segundo).
2. **`PutMetricData` directo** — descartado: exige IAM nuevo por servicio, y una dimensión
   `tenantId` sería trivial de agregar por accidente sin la disciplina de EMF, rompiendo el
   presupuesto de métricas sin que nadie lo note hasta la factura.
3. **Prometheus gestionado (Amazon Managed Prometheus) + Grafana gestionado (AMG)** — descartado:
   infraestructura nueva con costo propio, y el `/metrics` en formato Prometheus que ya existe en
   los 6 servicios no es consumido por nada en el despliegue real hoy — adoptar esta opción
   significaría *empezar* a pagar por algo que hoy es código sin efecto, exactamente lo que esta
   fase busca evitar ("control de costos").

**Aritmética que sustenta la decisión** (contra los 60 comprometidos en `cost-model.md` §3.5):
3 métricas RED × 6 procesos × 3 entornos = 54, + 1 métrica de seguridad sin dimensiones × 3
entornos = 3 → **57/60** ($17.10/mes). `route` y `tenantId` quedan descartados como dimensión: con
~30 rutas o con cientos de tenants, cualquiera de las dos rompe el presupuesto por completo.

### 3. Dashboard ejecutivo
1. **Extender el panel admin existente (`admin/`, Vite/React)** con una vista platform-wide
   nueva, combinando KPIs de negocio desde Postgres (ya existe el patrón per-tenant en
   Appointments) + RED técnico vía un endpoint que consulta CloudWatch `GetMetricData`.
   - Pros: reusa el stack de frontend ya construido (Layout, StatsCard, DataTable); un solo lugar
     para el usuario final (`clinic_owner`/`platform_admin` ya usan este panel).
   - Contras: acopla a Appointments una dependencia nueva (`@aws-sdk/client-cloudwatch`) para
     consultar métricas técnicas — mitigado separando ese endpoint (`/v1/platform/metrics`) del
     de negocio, para poder moverlo después sin tocar el contrato de negocio.
2. **`cloudwatch.Dashboard` nativo** — descartado como única fuente: no sabe nada de citas ni de
   ingresos (viven en Postgres), forzaría replicar esos datos como métricas custom solo para
   graficarlos ahí, rompiendo otra vez el presupuesto de métricas.
3. **Amazon Managed Grafana (AMG)** — descartado: infraestructura gestionada adicional con costo
   propio, mismo argumento que descartó Prometheus/Grafana gestionado en la decisión de métricas.

### 4. Presupuesto en `mx-central-1`
1. **Stack nuevo pinneado a `us-east-1`** para `AWS::Budgets::Budget` + Cost Anomaly Detection.
   - Pros: Cost Anomaly Detection (`aws-ce`) **no tiene alternativa** — su endpoint es únicamente
     `us-east-1` — así que este stack hay que crearlo de todos modos; mover el Budget ahí cierra
     la pregunta abierta #1 de `infra/README.md` en vez de arriesgarla en el primer deploy real.
   - Contras: excepción explícita a ADR-010 (residencia de datos en `mx-central-1`).
2. **Dejar el Budget en `mx-central-1` y esperar a que falle o no en el primer deploy real** —
   descartado: el guardrail del repo es no adivinar, y este ADR es la oportunidad de resolverlo
   por diseño en vez de por accidente.

### 5. Detección de acceso cross-tenant
1. **CloudWatch Logs Metric Filter sobre una línea de log estructurada** (`security-events.ts`),
   alimentando una única métrica sin dimensión de servicio.
   - Pros: no requiere llamadas a `PutMetricData`; la señal más fuerte (mismatch confirmado vía
     `resolve_tenant_for_X`) se origina exactamente donde ya vive la lógica de negocio, sin
     tocar la respuesta HTTP (sigue siendo 404, nunca 403 — amenaza #3 del threat model).
2. **Métrica dedicada vía `PutMetricData`** — descartada por el mismo motivo que en la decisión 2
   (IAM adicional, sin la ventaja del log estructurado ya disponible para Logs Insights).
3. **GuardDuty / Security Hub** — descartado para esta fase: detecta amenazas de infraestructura
   (credenciales comprometidas, tráfico anómalo de red), no un patrón de aplicación específico de
   este dominio (un actor de un tenant accediendo a un recurso de otro) — no sustituye la
   instrumentación a nivel de aplicación que este ADR describe, podría evaluarse como capa
   adicional en una fase futura.

## Decisión

Elegimos, respectivamente: **AWS X-Ray**, **CloudWatch EMF con dimensiones `[Service,
Environment]` únicamente**, **extender el panel admin existente**, **stack nuevo en `us-east-1`
para Budget + Cost Anomaly Detection**, y **detección cross-tenant por CloudWatch Logs Metric
Filter sobre logs estructurados**.

## Consecuencias

- **Positivas:** cero infraestructura nueva de terceros (Prometheus/Grafana/Jaeger gestionados);
  el desglose por tenant sale del mismo log que ya se escribe por otros motivos (correlación,
  auditoría futura); Cost Anomaly Detection queda resuelto en el mismo movimiento que cierra el
  gap de `mx-central-1`, en vez de dos decisiones separadas.
- **Negativas / tradeoffs:** lock-in a AWS para trazas (X-Ray) y para el modelo de costos
  (excepción de región); el drill-down por tenant existe para métricas de negocio pero no para
  error-rate/p95 (EMF no tiene esa dimensión) — el drill-down técnico por tenant es una consulta
  de Logs Insights, no un dato directamente graficable; quedan solo 3 métricas de headroom (57/60)
  antes de tener que retirar una métrica existente para agregar otra por-servicio.
- **Cosas a monitorear:**
  - El conteo real de métricas custom emitidas tras el wiring de EMF, contra las 60 comprometidas.
  - El crecimiento de ingesta de CloudWatch Logs por la línea EMF adicional por request (+20%
    aprox., ver `cost-model.md` §3.5 actualizado).
  - Disponibilidad y precio real de X-Ray en `mx-central-1` — **NO VERIFICADO**, el único riesgo
    que podría reabrir la decisión 1 (`docs/cost/precios-aws-consultados.md` solo confirmó 11
    servicios, X-Ray no es uno de ellos).
  - La excepción de región (`us-east-1` para Budget/Cost Anomaly) frente a ADR-010 — los datos ahí
    son metadatos de facturación de la cuenta AWS, no datos personales de pacientes.
  - La dependencia de Fase 5 para la redacción real de PII en logs — esta fase solo fija 3 reglas
    de emisión (nunca URL cruda, nunca query string, nunca body) y dos IDs opacos (`tenantId`,
    `requestId`), no implementa un redactor.
  - El mapeo de cuenta de entrega de ELB por región (`region-info`) para ALB access logs a S3 en
    `mx-central-1` — **NO VERIFICADO**, validado en la práctica con `cdk synth`.

## Referencias
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 6.
- `docs/cost/cost-model.md` §3.5 (presupuesto de métricas custom, ya aprobado en Gate 1).
- `docs/adr/ADR-010-region-residencia-datos.md` (excepción documentada, sin tocar su sección
  *Decisión*).
- `docs/adr/ADR-005-modelo-tenancy.md` (modelo pool — por qué no existe atribución de costo
  exacta por tenant).
- `docs/security/threat-model.md`, amenaza #3 (IDOR por posesión de UUID — la respuesta 404 no
  cambia, solo se agrega logging de seguridad en paralelo).
- `docs/backlog-deuda.md`, ítem 8 (gateway sin propagación de `request-id`, cerrado por esta fase).
