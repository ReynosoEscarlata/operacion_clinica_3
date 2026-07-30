# Cost Model — Challenge 5 "Plataforma para todos" (Fase 1)

**Fecha:** 2026-07-29
**Región:** mx-central-1
**Fuente de precios:** `docs/cost/precios-aws-consultados.md` (todos los precios unitarios citados abajo provienen de ese documento; toda fórmula se muestra explícitamente).
**Arquitectura costeada:** la determinada por ADR-005 (shared DB + tenant_id + RLS), ADR-007 (Fargate + Lambda híbrido), ADR-009 (1 cuenta, 3 entornos lógicos), ADR-010 (mx-central-1), ADR-011 (1 Cognito pool), ADR-013 (audit log a S3), ADR-014 (SQS + SNS/EventBridge, sin Redis), ADR-015 (RDS Single-AZ, backup & restore), ADR-016 (retención hardcodeada, sin costo extra).

**Alcance:** este cost model calcula el **entorno de producción**. Dev y staging (ADR-009) usan tallas menores y se asume que no corren 24/7 (se apagan fuera de horario de desarrollo) — no se incluyen en el total; si permanecieran encendidos 24/7 con talla mínima, sumarían aproximadamente el mismo orden de magnitud que el escenario de 10 clínicas dividido entre 2-3 (una fracción del total, no se cuantifica aquí por no ser el foco del presupuesto D6).

---

## 1. Supuestos

### 1.1 Supuestos por clínica (mensuales), usados en los tres escenarios

| Variable | Valor asumido | Nota |
|---|---|---|
| Médicos por clínica | 5 | Punto medio del rango 3-8 confirmado por Ricardo |
| Pacientes activos por clínica | 500 | Punto medio del rango 200-2,000 |
| Citas por día por clínica | 40 | Punto medio del rango 20-100 → 1,200 citas/mes por clínica |
| Notificaciones por cita | 2 | Confirmación + recordatorio. No incluye emails de cancelación/no-show — subestima el volumen real, se declara conservador |
| MB de adjuntos por paciente | **0** | El sistema hoy no tiene adjuntos (confirmado en `docs/baseline-challenge-4.md`, sección 3: "Buckets/S3: ninguno"). Es una proyección para cuando exista S3 de adjuntos en Fase 2/5. Se asume 0 explícitamente por instrucción del alcance de esta fase |
| Requests/día por clínica (vía gateway) | 1,000 | Incluye flujo público de reserva de citas (pacientes) + uso del panel admin/staff. Estimación de diseño, no medida — ver "Preguntas abiertas" |
| Mensajes SQS por cita | 6 | `AppointmentCreated`, `PaymentSucceeded`, `AppointmentStatusChanged` (×2 transiciones), evento de notificación despachado, trigger de recordatorio — reemplaza Redis Streams + BullMQ por ADR-014 |
| Usuarios con cuenta (MAU Cognito) por clínica | 7 | 5 médicos + 2 staff administrativo. Los pacientes NO tienen cuenta (la reserva es una ruta pública sin auth, confirmado en `docs/baseline-challenge-4.md` sección 5.1) |

### 1.2 Topología de cómputo por escenario

| Escenario | Fargate: talla × tareas/servicio | RDS: instancia (Single-AZ, ADR-015) |
|---|---|---|
| 10 clínicas | 0.25 vCPU / 0.5 GB × 1 tarea × 6 servicios (5 servicios + gateway) | db.t4g.micro, 20 GB gp3 |
| 100 clínicas | 0.5 vCPU / 1 GB × 2 tareas × 6 servicios | db.t4g.medium, 100 GB gp3 |
| 1000 clínicas | 1 vCPU / 2 GB × 3 tareas × 6 servicios | db.m7g.large, 500 GB gp3 |

Nota: el gateway es stateless (sin DB propia, confirmado en baseline) — se cuenta en Fargate pero no en RDS. Los otros 5 servicios (auth, appointments, doctors, payments, notifications) tienen una instancia RDS cada uno, consistente con "un Postgres por servicio" del baseline y sin cambios de ese modelo por ADR-005 (que decide tenancy *dentro* de cada Postgres, no consolida los 5 Postgres en uno).

Estas tallas son un supuesto de diseño para un sistema sin tráfico real medido todavía (confirmado en baseline: "no existe producción real"). Ver sección de sensibilidad para el impacto de escalar la talla de RDS.

### 1.3 Supuestos de mensajería, identidad y seguridad de borde (fijos, no escalan con clínicas salvo lo indicado)

- Secretos en Secrets Manager: 8 (5 credenciales de DB + Stripe secret key + Resend API key + config de Cognito/JWT) — no escala con el número de clínicas porque el modelo es shared-DB (ADR-005), sin secretos por tenant.
- Reglas WAF: 6 (fijas, no escalan con clínicas).
- Dashboards CloudWatch: 3 (ops/infra, negocio agregado, seguridad/auditoría) — dentro de la franquicia gratuita de 3 dashboards.
- Métricas custom CloudWatch: 60 (≈10 métricas RED por servicio × 6 servicios) — no escala con clínicas, escala con número de servicios/rutas.
- 1 NAT Gateway, 1 ALB, 1 Cognito User Pool (ADR-011) para toda la plataforma.

---

## 2. Unit economics

| Escenario | Total mensual | Costo/clínica/mes | Citas/mes | Costo/cita |
|---|---|---|---|---|
| 10 clínicas | $221.90 | $221.90 / 10 = **$22.19** | 12,000 | $221.90 / 12,000 = **$0.0185** |
| 100 clínicas | $641.05 | $641.05 / 100 = **$6.41** | 120,000 | $641.05 / 120,000 = **$0.0053** |
| 1000 clínicas | $1,838.84 | $1,838.84 / 1000 = **$1.84** | 1,200,000 | $1,838.84 / 1,200,000 = **$0.0015** |

El costo por clínica cae ~12x entre 10 y 1000 clínicas — la infraestructura compartida (RDS, Fargate, NAT, ALB, WAF, Secrets Manager) se amortiza sobre más clínicas sin crecer proporcionalmente, validando el argumento de "costo marginal por clínica ≈0" de ADR-005.

---

## 3. Escenarios 10 / 100 / 1000 clínicas

### 3.1 Fargate

Fórmula por tarea: `vCPU × 730h × $0.042504` + `GB memoria × 730h × $0.00466725`. Almacenamiento efímero: primeros 20 GB gratis por tarea, no se factura en estos escenarios (tallas usadas no superan esa franquicia).

| Escenario | Talla/tarea | Costo/tarea/mes | Tareas totales (6 servicios) | Total Fargate |
|---|---|---|---|---|
| 10 clínicas | 0.25 vCPU / 0.5 GB | 0.25×730×0.042504 + 0.5×730×0.00466725 = $7.76 + $1.70 = **$9.46** | 6 × 1 = 6 | 6 × $9.46 = **$56.76** |
| 100 clínicas | 0.5 vCPU / 1 GB | 0.5×730×0.042504 + 1×730×0.00466725 = $15.51 + $3.41 = **$18.92** | 6 × 2 = 12 | 12 × $18.92 = **$227.04** |
| 1000 clínicas | 1 vCPU / 2 GB | 1×730×0.042504 + 2×730×0.00466725 = $31.03 + $6.81 = **$37.84** | 6 × 3 = 18 | 18 × $37.84 = **$681.12** |

### 3.2 RDS PostgreSQL (5 instancias, una por servicio con estado; Single-AZ por ADR-015)

Fórmula por instancia: `precio-hora Single-AZ × 730h` + `storage GB × $0.121/GB-mes`.

| Escenario | Instancia | Storage | Costo/instancia/mes | 5 instancias | Total RDS |
|---|---|---|---|---|---|
| 10 clínicas | db.t4g.micro ($0.017/h) | 20 GB | 0.017×730 + 20×0.121 = $12.41 + $2.42 = **$14.83** | ×5 | **$74.15** |
| 100 clínicas | db.t4g.medium ($0.068/h) | 100 GB | 0.068×730 + 100×0.121 = $49.64 + $12.10 = **$61.74** | ×5 | **$308.70** |
| 1000 clínicas | db.m7g.large ($0.176/h) | 500 GB | 0.176×730 + 500×0.121 = $128.48 + $60.50 = **$188.98** | ×5 | **$944.90** |

Backup storage: franquicia gratuita no especificada en `precios-aws-consultados.md` (**NO VERIFICADO** el tamaño exacto de la franquicia; la tarifa de excedente $0.100/GB-mes sí está verificada). Se asume sin excedente en los tres escenarios porque el tamaño de storage usado es igual o menor al de la DB, dentro del rango típico de franquicia — supuesto a confirmar, no una cifra calculada.

### 3.3 SQS (reemplaza Redis Streams + BullMQ por completo, ADR-014)

Fórmula: `mensajes/mes = citas/mes × 6` (ver supuesto 1.1); free tier 1,000,000 req/mes; tarifa tier 1 $0.42/millón sobre el excedente.

| Escenario | Citas/mes | Mensajes/mes | Excedente sobre 1M gratis | Costo SQS |
|---|---|---|---|---|
| 10 clínicas | 12,000 | 72,000 | 0 (bajo el free tier) | **$0.00** |
| 100 clínicas | 120,000 | 720,000 | 0 (bajo el free tier) | **$0.00** |
| 1000 clínicas | 1,200,000 | 7,200,000 | 6,200,000 | 6.2 × $0.42 = **$2.60** |

**NO VERIFICADO:** costo de SNS y de EventBridge — ADR-014 exige SNS/EventBridge para el pub/sub de eventos de dominio, pero ninguno de los dos aparece en `precios-aws-consultados.md`. Este es un hueco real del modelo, no un detalle menor — se declara explícitamente en vez de estimarlo de memoria.

### 3.4 S3 (audit log export, ADR-013 + adjuntos futuros)

Supuesto: 30% de los requests/mes tocan PII y generan un registro de auditoría de ~500 bytes, exportado en lote diario a S3. Fórmula: `requests/mes × 30% × 500 bytes` → GB de storage/mes (costo del primer mes de acumulación, no un total multi-año — no se puede proyectar acumulación exacta a N años porque ADR-016 no especifica el número de días de retención, solo que es "hardcodeada"; **NO VERIFICADO** el valor de retención en días).

| Escenario | Requests/mes (todas las clínicas) | Registros de auditoría/mes | GB storage/mes | Costo storage | PUT/GET (negligible) | Total S3 |
|---|---|---|---|---|---|---|
| 10 clínicas | 300,000 | 90,000 | 0.045 GB | 0.045×$0.02415=$0.0011 | ~$0.0002 | **$0.01** (redondeado) |
| 100 clínicas | 3,000,000 | 900,000 | 0.45 GB | $0.0109 | ~$0.002 | **$0.02** |
| 1000 clínicas | 30,000,000 | 9,000,000 | 4.5 GB | $0.1087 | ~$0.02 | **$0.15** |

Adjuntos futuros: **$0** en los tres escenarios (0 MB/paciente, confirmado como supuesto explícito de la sección 1.1 — no existe la funcionalidad hoy).

### 3.5 CloudWatch (logs, métricas, dashboards)

Fórmula de logs: `requests/día × clínicas × 30 días × 3 servicios tocados/request × 5 líneas de log/servicio × 300 bytes/línea` → GB ingeridos/mes × $0.50/GB. Storage asumido igual al volumen ingerido del mes (retención corta) × $0.03/GB-mes.

| Escenario | Requests/mes (todas) | Líneas de log/mes | GB ingeridos | Costo ingesta | Costo storage | Métricas custom (fijo) | Dashboards (fijo) | Total CloudWatch |
|---|---|---|---|---|---|---|---|---|
| 10 clínicas | 300,000 | 4,500,000 | 1.35 GB | $0.675 | $0.041 | $18.00 (60 métricas × $0.30) | $0.00 (3 dashboards, dentro de franquicia gratis) | **$18.72** |
| 100 clínicas | 3,000,000 | 45,000,000 | 13.5 GB | $6.75 | $0.405 | $18.00 | $0.00 | **$25.15** |
| 1000 clínicas | 30,000,000 | 450,000,000 | 135 GB | $67.50 | $4.05 | $18.00 | $0.00 | **$89.55** |

Este es el recurso donde efectivamente aparece "la sorpresa clásica" de logs — pero solo se materializa con fuerza a escala de 1000 clínicas ($67.50 de ingesta); a 10 clínicas es marginal ($0.68).

### 3.6 Cognito (1 pool compartido, ADR-011)

Fórmula: `MAU = 7 × clínicas`. Franquicia gratuita: 50,000 MAU/mes (tier clásico).

| Escenario | MAU | ¿Excede 50,000 gratis? | Costo Cognito |
|---|---|---|---|
| 10 clínicas | 70 | No | **$0.00** |
| 100 clínicas | 700 | No | **$0.00** |
| 1000 clínicas | 7,000 | No | **$0.00** |

Hallazgo: incluso a 1000 clínicas, Cognito permanece dentro de la franquicia gratuita bajo este supuesto de MAU — no es un costo relevante en ningún escenario de este modelo.

### 3.7 ALB

Fórmula: `$0.023625/h × 730h` (fijo) + `LCU-hora × $0.0084` (aproximado, ver caveat).

**Caveat:** el número de LCU-hora usado abajo es una aproximación de diseño (1/2/5 LCU-hora constantes), no el cálculo dimensional real de AWS (que toma el máximo entre nuevas conexiones/seg, conexiones activas, bytes procesados y evaluaciones de regla). El precio por LCU ($0.0084/hora) sí está verificado; el conteo de LCU necesario no lo está.

| Escenario | Costo fijo/hora | LCU-hora asumidas | Costo LCU | Total ALB |
|---|---|---|---|---|
| 10 clínicas | $17.25 | 730 (1 LCU) | $6.13 | **$23.38** |
| 100 clínicas | $17.25 | 1,460 (2 LCU) | $12.26 | **$29.51** |
| 1000 clínicas | $17.25 | 3,650 (5 LCU) | $30.66 | **$47.91** |

### 3.8 WAF

Fórmula: `$5.00 Web ACL` + `6 reglas × $1.00` + `requests/mes × $0.60/millón` (tier 0).

⚠️ Se hereda la advertencia de la fuente: existe una discrepancia 10x entre el campo `description` y el campo `pricePerUnit` en los datos de mx-central-1 para Web ACL/reglas. Se usa `pricePerUnit` ($5/$1) por ser el campo de facturación real, pero **no se pudo confirmar de forma independiente** — ver `precios-aws-consultados.md` sección 9 antes de comprometer el diseño.

| Escenario | Base (ACL + reglas) | Requests/mes (todas) | Costo requests | Total WAF |
|---|---|---|---|---|
| 10 clínicas | $11.00 | 300,000 | $0.18 | **$11.18** |
| 100 clínicas | $11.00 | 3,000,000 | $1.80 | **$12.80** |
| 1000 clínicas | $11.00 | 30,000,000 | $18.00 | **$29.00** |

### 3.9 NAT Gateway

Fórmula: `$0.04725/h × 730h` (fijo) + `GB procesados × $0.04725`. GB procesados = `citas/mes × 25 KB` (1 llamada a Stripe ~5KB + 2 notificaciones vía Resend ~10KB c/u).

| Escenario | Costo fijo | Citas/mes | GB procesados | Costo procesamiento | Total NAT |
|---|---|---|---|---|---|
| 10 clínicas | $34.49 | 12,000 | 0.3 GB | $0.01 | **$34.50** |
| 100 clínicas | $34.49 | 120,000 | 3.0 GB | $0.14 | **$34.63** |
| 1000 clínicas | $34.49 | 1,200,000 | 30.0 GB | $1.42 | **$35.91** |

Hallazgo: el cargo fijo por hora domina casi por completo — NAT Gateway cuesta prácticamente lo mismo ($34.50-$35.91) en los tres escenarios porque el tráfico real de este sistema (llamadas a Stripe/Resend) es minúsculo comparado con el cargo de tenerlo encendido 24/7.

### 3.10 Secrets Manager

Fórmula: `8 secretos × $0.40/secreto-mes` + llamadas API (negligible, con caché en cada servicio).

| Escenario | Costo |
|---|---|
| 10 / 100 / 1000 clínicas | **$3.20** (fijo — no escala con clínicas porque el modelo es shared-DB sin secretos por tenant) |

### 3.11 Transferencia de datos (egress a Internet)

Fórmula: `requests/mes × 5 KB/respuesta promedio` → GB/mes; primeros 100 GB/mes gratis (franquicia global); excedente a $0.09/GB.

| Escenario | Requests/mes (todas) | GB egress | ¿Excede 100GB gratis? | Costo |
|---|---|---|---|---|
| 10 clínicas | 300,000 | 1.5 GB | No | **$0.00** |
| 100 clínicas | 3,000,000 | 15 GB | No | **$0.00** |
| 1000 clínicas | 30,000,000 | 150 GB | Sí, 50 GB excedente | 50×$0.09 = **$4.50** |

### 3.12 Lambda (jobs programados de bajo volumen, ADR-007)

Fórmula: purga de retención (job diario, 128 MB, 5 seg, 30 invocaciones/mes) + aprovisionamiento de tenant (invocado por alta de clínica, volumen bajo en los tres escenarios). GB-segundos y requests quedan muy por debajo de la franquicia gratuita (400,000 GB-s y 1,000,000 requests/mes).

| Escenario | Costo Lambda |
|---|---|
| 10 / 100 / 1000 clínicas | **$0.00** (dentro de la franquicia gratuita en los tres escenarios) |

### 3.13 Totales por escenario

| Recurso | 10 clínicas | 100 clínicas | 1000 clínicas |
|---|---:|---:|---:|
| Fargate | $56.76 | $227.04 | $681.12 |
| RDS | $74.15 | $308.70 | $944.90 |
| SQS | $0.00 | $0.00 | $2.60 |
| S3 | $0.01 | $0.02 | $0.15 |
| CloudWatch | $18.72 | $25.15 | $89.55 |
| Cognito | $0.00 | $0.00 | $0.00 |
| ALB | $23.38 | $29.51 | $47.91 |
| WAF | $11.18 | $12.80 | $29.00 |
| NAT Gateway | $34.50 | $34.63 | $35.91 |
| Secrets Manager | $3.20 | $3.20 | $3.20 |
| Transferencia de datos | $0.00 | $0.00 | $4.50 |
| **TOTAL** | **$221.90** | **$641.05** | **$1,838.84** |
| **vs. presupuesto D6 ($150-300 a 10 clínicas)** | **Dentro del rango** | N/A (solo "techo a evaluar") | N/A |

---

## 4. Comparativa-tenancy (retrospectiva — ADR-005 ya decidió shared DB + RLS)

Esta sección no reabre la decisión de ADR-005; muestra con números reales por qué esa decisión fue la correcta frente a las otras dos opciones consideradas en el ADR.

### 4.1 DB-per-tenant (Opción 3 descartada en ADR-005)

Una instancia RDS completa por clínica por servicio (5 servicios × N clínicas). Talla mínima db.t4g.micro Single-AZ + 5 GB storage por instancia (menor que el shared porque el volumen de datos por tenant es pequeño).

Fórmula por instancia: `0.017×730 + 5×0.121 = $12.41 + $0.605 = $13.02`.

| Escenario | Instancias RDS necesarias | Total RDS (db-per-tenant) | Total RDS (shared, ADR-005) | Multiplicador |
|---|---|---|---|---|
| 10 clínicas | 5 × 10 = 50 | $651.00 | $74.15 | **8.78x** |
| 100 clínicas | 5 × 100 = 500 | $6,510.00 | $308.70 | **21.09x** |
| 1000 clínicas | 5 × 1000 = 5,000 | $65,100.00 | $944.90 | **68.90x** |

A 1000 clínicas, 5,000 instancias RDS también chocarían con los límites de servicio por defecto de RDS por cuenta/región (típicamente decenas de instancias, no miles, sin solicitar aumento de cuota) — un problema operativo además del de costo.

### 4.2 Schema-per-tenant (Opción 2 descartada en ADR-005)

Mismas 5 instancias que el modelo shared (un esquema por clínica dentro de cada Postgres), pero se estima una talla de instancia mayor para absorber el overhead de catálogo/conexiones de manejar muchos esquemas — una aproximación direccional, no un SKU específico de "costo por esquema" (no existe ese precio en el documento consultado).

| Escenario | Instancia estimada | Storage | Costo/instancia | Total (5 instancias) | Total shared (ADR-005) | Multiplicador |
|---|---|---|---|---|---|---|
| 10 clínicas | db.t4g.medium | 40 GB | 0.068×730+40×0.121=$49.64+$4.84=$54.48 | $272.40 | $74.15 | **3.67x** |
| 100 clínicas | db.m7g.large | 200 GB | 0.176×730+200×0.121=$128.48+$24.20=$152.68 | $763.40 | $308.70 | **2.47x** |
| 1000 clínicas | db.m7g.large (techo del catálogo verificado) | 1000 GB | 0.176×730+1000×0.121=$128.48+$121.00=$249.48 | $1,247.40 | $944.90 | **1.32x** (subestimado — ver nota) |

**Nota importante:** a 1000 clínicas, schema-per-tenant probablemente ya no es viable con una sola instancia db.m7g.large por los límites prácticos de Postgres en número de esquemas mencionados en ADR-005 — este número (1.32x) es una cota inferior optimista, no una proyección confiable a esa escala. No hay un SKU de instancia mayor verificado en `precios-aws-consultados.md` para modelar el escenario real (marcado como gap, no como cifra inventada).

### 4.3 Conclusión de la comparativa

En los tres escenarios, shared DB + RLS (ADR-005) es la opción más barata, y la brecha relativa se amplía con la escala frente a db-per-tenant (8.78x → 68.90x), justo lo contrario de lo que pasaría si el shared model tuviera costos ocultos que emergieran a escala. Schema-per-tenant queda siempre en un punto intermedio, con el agravante de un techo operativo real (límite de esquemas de Postgres) que este documento no puede costear con precisión a 1000 clínicas.

---

## 5. Sensibilidad

Todos los escenarios de sensibilidad parten del escenario base de **10 clínicas ($221.90/mes)**, cambiando una sola variable a la vez.

### 5.1 El tráfico se duplica (10 clínicas, misma talla de infraestructura)

Solo afectan los componentes basados en volumen: CloudWatch (logs), ALB (LCU), WAF (requests), NAT (GB procesados). SQS, Cognito, transferencia de datos y S3 permanecen en $0 o negligibles porque están muy por debajo de sus franquicias gratuitas incluso al doble.

| Componente | Delta |
|---|---|
| CloudWatch (2.7 GB ingeridos) | +$0.71 |
| ALB (2 LCU en vez de 1) | +$6.13 |
| WAF (0.6M requests) | +$0.18 |
| NAT (0.6 GB procesados) | +$0.02 |
| **Nuevo total** | **$228.94** (+$7.04, +3.2%) |

**Hallazgo:** duplicar el tráfico a escala de 10 clínicas apenas mueve el total porque los costos dominantes (Fargate, RDS, NAT fijo, Secrets Manager) son de capacidad reservada, no de uso — insensibles al tráfico en este rango de volumen.

### 5.2 RDS pasa a la siguiente talla: db.t4g.medium en vez de db.t4g.micro (10 clínicas)

Nuevo costo RDS: 5 × $61.74 = $308.70 (delta = +$234.55 sobre los $74.15 base).

**Nuevo total: $456.45/mes — rompe el presupuesto de $150-300 por 1.5x-3x.**

### 5.3 RDS pasa a db.m7g.large (10 clínicas)

Nuevo costo RDS: 5 × $188.98 = $944.90 (delta = +$870.75).

**Nuevo total: $1,092.65/mes — catastrófico frente al presupuesto.**

### 5.4 Se activa Multi-AZ pese a ADR-015, manteniendo db.t4g.micro (10 clínicas)

`precios-aws-consultados.md` documenta que el multiplicador Multi-AZ vs. Single-AZ es exactamente 2.0x tanto en precio de instancia como de storage gp3, para las tres tallas verificadas.

Nuevo costo RDS: `0.034×730 + 20×0.242 = $24.82 + $4.84 = $29.66/instancia × 5 = $148.30` (delta = +$74.15, exactamente 2x el RDS base, tal como indica la fuente).

**Nuevo total: $296.05/mes — queda justo dentro del rango de $150-300 (al límite superior).**

**Hallazgo clave de esta sección:** activar Multi-AZ por sí solo, sin tocar la talla de instancia, es *casi* costeable dentro del presupuesto austero. Pero combinarlo con cualquier bump de talla (5.2 o 5.3) rompe el presupuesto de inmediato. Esto confirma que las dos decisiones de ADR-015 (Single-AZ) y de la talla mínima elegida (db.t4g.micro) son ambas condiciones necesarias para cumplir D6 — no basta con mantener una de las dos si se reconsiderara la otra en el futuro.

---

## Conclusión: ¿está dentro del presupuesto D6?

| Escenario | Total mensual | ¿Dentro de $150-300/mes? |
|---|---|---|
| **10 clínicas** | $221.90 | **Sí** — dentro del rango, con margen de ~$78/mes hasta el techo de $300 |
| **100 clínicas** | $641.05 | **No** en términos absolutos, pero el plan maestro solo fija $150-300 como obligatorio a 10 clínicas y pide "evaluar techo" a 100 — el costo por clínica ($6.41) es 3.5x menor que a 10 clínicas, mostrando buena economía de escala |
| **1000 clínicas** | $1,838.84 | **No** en términos absolutos — costo por clínica ($1.84) sigue bajando, validando el modelo shared-DB, pero el total requeriría negociar un presupuesto mayor si la plataforma llega a esa escala |

El escenario de referencia (10 clínicas) **cumple el Gate 1** ("el cost model esté dentro del presupuesto D6"). El margen de $78/mes hasta el techo es delgado: como muestra la sección de sensibilidad, un solo cambio de talla de RDS (a t4g.medium) ya rompe el presupuesto, y activar Multi-AZ por sí solo lo deja al límite. Cualquier decisión futura que toque la talla de RDS o la topología de Fargate debe re-verificarse contra este modelo antes de aplicarse.

---

## Preguntas abiertas para el humano

1. **Supuestos de tráfico:** ¿5 médicos, 500 pacientes activos, 40 citas/día y 1,000 requests/día por clínica son razonables para el caso real de Ricardo, o hay clínicas objetivo que rebasan estos números? Todo el modelo escala linealmente con estos supuestos.
2. **MAU de Cognito:** se asumió que solo médicos + staff administrativo tienen cuenta (7 usuarios/clínica), no los pacientes (ruta pública sin auth). ¿Es correcto, o los médicos no inician sesión directamente y el MAU real es menor?
3. **Redundancia de Fargate:** el escenario de 10 clínicas asume 1 sola tarea por servicio (sin HA/redundancia), consistente con la postura general de bajo presupuesto de ADR-015 pero no decidida explícitamente para cómputo. ¿Es aceptable ese riesgo de disponibilidad a esa escala, o se requiere mínimo 2 tareas por servicio incluso a 10 clínicas (esto empujaría el total hacia ~$278/mes solo por Fargate duplicado, todavía dentro del rango pero con menos margen)?
4. **Hueco de SNS/EventBridge:** ADR-014 exige SNS/EventBridge para el pub/sub de eventos de dominio, pero no hay precio verificado para ninguno de los dos en `precios-aws-consultados.md`. Se necesita esa investigación de precios antes de cerrar el diseño de mensajería — hoy es un costo no contemplado en el total.
5. **Gateway en Fargate:** ¿corre el gateway en Fargate 24/7 como los demás servicios (como se asumió aquí, 1/6 del costo de Fargate), o existe una alternativa más económica (ej. Amazon API Gateway nativo con autorizador Lambda) que no fue evaluada porque ADR-007 solo mencionaba explícitamente los 5 servicios con estado?
6. **Franquicia gratuita de backup de RDS:** no se encontró en el documento de precios el tamaño de la franquicia gratuita de backup storage (solo la tarifa de excedente). Se asumió sin excedente en los tres escenarios — vale la pena confirmar en la consola de AWS antes de comprometer el número.
7. **Retención de logs/datos (ADR-016):** no hay una cifra de días de retención especificada en los ADRs leídos, lo que impide proyectar la acumulación real de storage de S3/CloudWatch a 1, 3 o 5 años. Se presentó solo el costo incremental mensual — se necesita el número de días/años exacto de retención por tipo de dato para completar esa proyección.
