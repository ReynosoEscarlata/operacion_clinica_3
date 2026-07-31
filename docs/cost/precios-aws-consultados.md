# Precios AWS consultados — Challenge 5 (SaaS B2B multi-tenant)

**Fecha de consulta:** 29 de julio de 2026
**Región decidida:** `mx-central-1` (México Central)
**Región de respaldo (fallback):** `us-east-1` (Norte de Virginia) — se documenta explícitamente cuando aplica

## Metodología

Los precios de este documento se obtuvieron directamente de la **AWS Price List Bulk API** (`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/...`), que es la fuente de datos programática oficial de AWS y la misma que alimenta la AWS Pricing Calculator y la consola de precios. Para cada servicio se descargó el índice general (`/offers/v1.0/aws/<servicio>/current/region_index.json`) para confirmar si `mx-central-1` tiene un archivo de precios publicado, y luego el archivo específico de la región (`/offers/v1.0/aws/<servicio>/<version>/<región>/index.json`) para extraer el `pricePerUnit` real de cada SKU.

Esto se usó porque las páginas de marketing de precios (`aws.amazon.com/<servicio>/pricing/`) renderizan sus tablas vía JavaScript del lado del cliente y no exponen los números en el HTML estático — por eso no se citan como fuente primaria salvo que se indique lo contrario.

**Hallazgo general importante:** los 11 servicios investigados tienen archivos de precios publicados para `mx-central-1` en la Price List API — es decir, AWS publica SKUs region-específicos para todos ellos, lo cual es una señal fuerte (no 100% concluyente por sí sola) de que están operativamente disponibles en esa región. Para Cognito se confirmó adicionalmente con el anuncio oficial de lanzamiento regional (ver sección Cognito). Aun así, se recomienda una verificación final en la consola de AWS antes de comprometer el diseño (ver "Preguntas abiertas").

---

## 1. Fargate (cómputo Linux, on-demand)

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| vCPU-hora (Linux/x86) | $0.042504 | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260707160651/mx-central-1/index.json | 2026-07-29 |
| GB-hora memoria (Linux/x86) | $0.00466725 | mx-central-1 | (misma fuente) | 2026-07-29 |
| Almacenamiento efímero, GB-hora | $0.00011655 | mx-central-1 | (misma fuente) | 2026-07-29 |
| vCPU-hora (Linux/ARM, Graviton) | $0.033999 | mx-central-1 | (misma fuente) | 2026-07-29 |
| GB-hora memoria (Linux/ARM) | $0.003738 | mx-central-1 | (misma fuente) | 2026-07-29 |
| vCPU-hora (Linux/x86) — referencia | $0.04048 | us-east-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260707160651/us-east-1/index.json | 2026-07-29 |
| GB-hora memoria (Linux/x86) — referencia | $0.004445 | us-east-1 | (misma fuente) | 2026-07-29 |
| vCPU-hora (Linux/ARM) — referencia | $0.03238 | us-east-1 | (misma fuente) | 2026-07-29 |
| GB-hora memoria (Linux/ARM) — referencia | $0.00356 | us-east-1 | (misma fuente) | 2026-07-29 |

Nota: mx-central-1 es ~5% más caro que us-east-1 en Fargate x86 y ~5% en ARM. Ambos disponibles y con SKU propio en mx-central-1 (no requiere fallback).

---

## 2. Lambda

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| GB-segundo (x86, tier 1: 0–6,000M GB-s) | $0.0000175 | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/20260717075216/mx-central-1/index.json | 2026-07-29 |
| GB-segundo (x86, tier 2: 6,000M–15,000M) | $0.00001575 | mx-central-1 | (misma fuente) | 2026-07-29 |
| GB-segundo (x86, tier 3: >15,000M) | $0.000014 | mx-central-1 | (misma fuente) | 2026-07-29 |
| GB-segundo (ARM, tier 1: 0–7,500M) | $0.000014 | mx-central-1 | (misma fuente) | 2026-07-29 |
| Precio por request | $0.00000021 (=$0.21 por millón) | mx-central-1 | (misma fuente) | 2026-07-29 |
| GB-segundo (x86, tier 1) — referencia | $0.0000166667 | us-east-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/20260717075216/us-east-1/index.json | 2026-07-29 |
| GB-segundo (ARM, tier 1) — referencia | $0.0000133334 | us-east-1 | (misma fuente) | 2026-07-29 |
| Precio por request — referencia | $0.0000002 (=$0.20 por millón) | us-east-1 | (misma fuente) | 2026-07-29 |

Free tier (ambas regiones, según la misma fuente): 1M requests/mes y 400,000 GB-segundo/mes gratis.

---

## 3. RDS PostgreSQL

### Instancias (precio por hora, On-Demand, "No license required")

| Instancia | Single-AZ | Multi-AZ (standby clásico) | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|---|
| db.t4g.micro (2 vCPU, 1 GiB) | $0.017 | $0.034 | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20260729234248/mx-central-1/index.json | 2026-07-29 |
| db.t4g.medium (2 vCPU, 4 GiB) | $0.068 | $0.135 | mx-central-1 | (misma fuente) | 2026-07-29 |
| db.m7g.large (2 vCPU, 8 GiB) | $0.176 | $0.352 | mx-central-1 | (misma fuente) | 2026-07-29 |
| db.t4g.micro — referencia | $0.016 | $0.032 | us-east-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20260729234248/us-east-1/index.json | 2026-07-29 |
| db.t4g.medium — referencia | $0.065 | $0.129 | us-east-1 | (misma fuente) | 2026-07-29 |
| db.m7g.large — referencia | $0.168 | $0.337 | us-east-1 | (misma fuente) | 2026-07-29 |

El multiplicador Multi-AZ vs Single-AZ es exactamente **2.0x** en las tres instancias, en ambas regiones.

### Storage, IOPS y backups (PostgreSQL, mx-central-1)

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| Storage gp3, Single-AZ | $0.121 / GB-mes | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20260729234248/mx-central-1/index.json | 2026-07-29 |
| Storage gp3, Multi-AZ | $0.242 / GB-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| IOPS provisionados gp3, Single-AZ | $0.021 / IOPS-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| IOPS provisionados gp3, Multi-AZ | $0.042 / IOPS-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Storage io1/io2, Single-AZ | $0.131 / GB-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| IOPS io1/io2, Single-AZ | $0.105 / IOPS-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Backup storage (excedente sobre la franquicia gratis) | $0.100 / GB-mes | mx-central-1 | (misma fuente) | 2026-07-29 |

Nota: existe también la opción "Multi-AZ (readable standbys)" (RDS Multi-AZ DB Cluster) en el catálogo de mx-central-1, pero no está publicada para `db.t4g.micro`, `db.t4g.medium` ni `db.m7g.large` — solo para instancias mayores. No se incluye precio porque no aplica a las instancias solicitadas.

---

## 4. SQS

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| Standard, tier 1 (0–100B req/mes) | $0.42 / millón | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/index.json | 2026-07-29 |
| Standard, tier 2 (100B–200B) | $0.315 / millón | mx-central-1 | (misma fuente) | 2026-07-29 |
| Standard, tier 3 (>200B) | $0.252 / millón | mx-central-1 | (misma fuente) | 2026-07-29 |
| FIFO, tier 1 | $0.525 / millón | mx-central-1 | (misma fuente) | 2026-07-29 |
| FIFO, tier 2 | $0.42 / millón | mx-central-1 | (misma fuente) | 2026-07-29 |
| FIFO, tier 3 | $0.3675 / millón | mx-central-1 | (misma fuente) | 2026-07-29 |
| Fair queue | $0.105 / millón | mx-central-1 | (misma fuente) | 2026-07-29 |
| Standard, tier 1 — referencia | $0.40 / millón | us-east-1 | (misma fuente) | 2026-07-29 |
| FIFO, tier 1 — referencia | $0.50 / millón | us-east-1 | (misma fuente) | 2026-07-29 |

Free tier (ambas regiones): 1 millón de requests/mes gratis.

---

## 5. S3

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| Standard storage, primeros 50 TB/mes | $0.02415 / GB-mes | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20260728131000/mx-central-1/index.json | 2026-07-29 |
| Standard storage, siguientes 450 TB/mes | $0.0231 / GB-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Standard storage, >500 TB/mes | $0.02205 / GB-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| PUT/COPY/POST/LIST | $0.00525 por 1,000 requests | mx-central-1 | (misma fuente) | 2026-07-29 |
| GET y demás requests | $0.0042 por 10,000 requests (= $0.00042/1,000) | mx-central-1 | (misma fuente) | 2026-07-29 |
| Transferencia saliente a Internet, primeros 10 TB/mes | $0.09 / GB | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260720184645/mx-central-1/index.json | 2026-07-29 |
| Transferencia saliente a Internet, siguientes 40 TB/mes | $0.085 / GB | mx-central-1 | (misma fuente) | 2026-07-29 |
| Transferencia saliente a Internet, siguientes 100 TB/mes | $0.07 / GB | mx-central-1 | (misma fuente) | 2026-07-29 |
| Transferencia saliente a Internet, >150 TB/mes | $0.05 / GB | mx-central-1 | (misma fuente) | 2026-07-29 |
| Standard storage, primeros 50 TB — referencia | $0.023 / GB-mes | us-east-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20260728131000/us-east-1/index.json | 2026-07-29 |
| PUT/COPY/POST/LIST — referencia | $0.005 por 1,000 requests | us-east-1 | (misma fuente) | 2026-07-29 |
| GET y demás — referencia | $0.0004 por 1,000 requests | us-east-1 | (misma fuente) | 2026-07-29 |

Free tier global (ambas regiones): primeros 100 GB/mes de transferencia saliente a Internet gratis, agregados globalmente por cuenta. La transferencia saliente a Internet tiene el mismo precio en mx-central-1 y us-east-1.

---

## 6. CloudWatch

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| Logs ingeridos (Standard) | $0.50 / GB | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20260729191940/mx-central-1/index.json | 2026-07-29 |
| Logs almacenados (Standard) | $0.03 / GB-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Logs almacenados (Infrequent Access) | $0.018 / GB-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Logs almacenados (Archive/AIA) | $0.006 / GB-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Métrica custom, primeras 10,000/mes | $0.30 / métrica-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Métrica custom, siguientes 240,000/mes | $0.10 / métrica-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Métrica custom, siguientes 750,000/mes | $0.05 / métrica-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Métrica custom, >1,000,000/mes | $0.02 / métrica-mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Dashboard personalizado | $3.00 / dashboard-mes | Global (no diferenciado por región) | https://aws.amazon.com/cloudwatch/pricing/ | 2026-07-29 |

Nota sobre dashboards: este precio **no aparece en la AWS Price List Bulk API** para ningún servicio ni región (se buscó en los archivos de mx-central-1 y us-east-1 sin encontrar coincidencias) — es una tarifa fija global que AWS solo publica en su página de marketing. Se confirmó mediante búsqueda web citando la página oficial de precios; no se pudo renderizar la tabla exacta vía fetch directo por ser contenido generado con JavaScript. Las primeras 3 dashboards custom (hasta 50 métricas c/u) son gratis; los dashboards automáticos siempre son gratis.

---

## 7. Cognito

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| User Pools (clásico), franquicia gratis | 50,000 MAU/mes gratis | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCognito/20260622204707/mx-central-1/index.json | 2026-07-29 |
| User Pools (clásico), tier 1 (0–50k tras franquicia) | $0.0055 / MAU | mx-central-1 | (misma fuente) | 2026-07-29 |
| User Pools (clásico), tier 2 (50k–950k) | $0.0046 / MAU | mx-central-1 | (misma fuente) | 2026-07-29 |
| User Pools (clásico), tier 3 (950k–9.95M) | $0.00325 / MAU | mx-central-1 | (misma fuente) | 2026-07-29 |
| User Pools (clásico), tier 4 (>9.95M) | $0.0025 / MAU | mx-central-1 | (misma fuente) | 2026-07-29 |
| Tier "Lite", franquicia gratis | 10,000 MAU/mes gratis | mx-central-1 | (misma fuente) | 2026-07-29 |
| Tier "Lite" (0–90k) | $0.0055 / MAU | mx-central-1 | (misma fuente) | 2026-07-29 |
| Tier "Essentials" (flat, tras franquicia) | $0.015 / MAU | mx-central-1 | (misma fuente) | 2026-07-29 |
| Tier "Plus" (flat) | $0.02 / MAU | mx-central-1 | (misma fuente) | 2026-07-29 |

Todos los tiers son **idénticos en precio** entre mx-central-1 y us-east-1, según la misma fuente.

**Confirmación de disponibilidad regional:** Amazon Cognito se lanzó oficialmente en mx-central-1 en julio de 2025, según el anuncio oficial: https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-cognito-thailand-and-mexico-central-regions (consultado 2026-07-29). Esto confirma que Cognito **no requiere fallback a us-east-1** para este proyecto.

---

## 8. ALB (Application Load Balancer)

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| Por hora (LoadBalancer-hour) | $0.023625 / hora | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260720184950/mx-central-1/index.json | 2026-07-29 |
| Por LCU (Load Balancer Capacity Unit) | $0.0084 / LCU-hora | mx-central-1 | (misma fuente) | 2026-07-29 |
| Por hora — referencia | $0.0225 / hora | us-east-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260720184950/us-east-1/index.json | 2026-07-29 |
| Por LCU — referencia | $0.008 / LCU-hora | us-east-1 | (misma fuente) | 2026-07-29 |

---

## 9. WAF

| Recurso | Precio unitario (pricePerUnit, campo usado para facturación) | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| Web ACL | $5.00 / mes | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/20260107213453/mx-central-1/index.json | 2026-07-29 |
| Regla (por regla creada) | $1.00 / mes | mx-central-1 | (misma fuente) | 2026-07-29 |
| Solicitudes, tier 0 (base) | $0.60 / millón | mx-central-1 | (misma fuente) | 2026-07-29 |
| Solicitudes, tier 8 (5000 WCU) | $2.00 / millón | mx-central-1 | (misma fuente) | 2026-07-29 |
| Web ACL — referencia | $5.00 / mes | us-east-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/20260107213453/us-east-1/index.json | 2026-07-29 |
| Regla — referencia | $1.00 / mes | us-east-1 | (misma fuente) | 2026-07-29 |
| Solicitudes, tier 0 — referencia | $0.60 / millón | us-east-1 | (misma fuente) | 2026-07-29 |

**⚠️ Anomalía detectada en los datos de AWS (no verificada del todo — requiere confirmación manual):** en el archivo de mx-central-1, el campo `description` (texto legible) de "Web ACL", "Regla" y las suscripciones AMR (Bot Control, ATP, Fraud Control) muestra un valor **10 veces mayor** al campo `pricePerUnit` real (ej. la descripción dice "$50 per Month for Web ACL" pero `pricePerUnit` = "5.0000000000"). En us-east-1 ambos campos coinciden exactamente. El campo `pricePerUnit` es el que AWS usa para facturar (es el mismo que consume la Pricing Calculator), por lo que se reporta $5.00/mes como el precio real, pero se marca esta fila con advertencia porque no se pudo confirmar de forma independiente cuál campo tiene el error tipográfico. Ver sección de preguntas abiertas.

---

## 10. NAT Gateway

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| Por hora | $0.04725 / hora | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20260728175247/mx-central-1/index.json | 2026-07-29 |
| Por GB procesado | $0.04725 / GB | mx-central-1 | (misma fuente) | 2026-07-29 |
| Por hora — referencia | $0.045 / hora | us-east-1 | https://aws.amazon.com/vpc/pricing/ | 2026-07-29 |
| Por GB procesado — referencia | $0.045 / GB | us-east-1 | https://aws.amazon.com/vpc/pricing/ | 2026-07-29 |

Nota metodológica: el precio de mx-central-1 se extrajo directamente de la Price List Bulk API (archivo de ~100 MB, `productFamily: "NAT Gateway"`, servicecode `AmazonEC2` — NAT Gateway se factura bajo el código de servicio EC2, no VPC). El archivo equivalente de us-east-1 pesa ~480 MB y no pudo descargarse de forma estable en esta sesión (se perdió por una limpieza de archivos temporales a mitad de proceso); el valor de referencia para us-east-1 se confirmó en su lugar por búsqueda web citando la página oficial `aws.amazon.com/vpc/pricing`, coincidiendo con el valor histórico público y estable de $0.045/$0.045 que AWS mantiene desde 2018. Se recomienda re-verificar directamente si se requiere precisión absoluta para us-east-1.

---

## 11. Secrets Manager

| Recurso | Precio unitario | Región | Fuente (URL) | Fecha de consulta |
|---|---|---|---|---|
| Por secreto-mes | $0.40 | mx-central-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/20250828153804/mx-central-1/index.json | 2026-07-29 |
| Por 10,000 llamadas API | $0.05 | mx-central-1 | (misma fuente) | 2026-07-29 |
| Por secreto-mes — referencia | $0.40 | us-east-1 | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/20250828153804/us-east-1/index.json | 2026-07-29 |
| Por 10,000 llamadas API — referencia | $0.05 | us-east-1 | (misma fuente) | 2026-07-29 |

Idéntico en ambas regiones.

---

## 12. X-Ray y CloudWatch GetMetricData (Fase 6, ADR-017) — NO VERIFICADO

A diferencia de los 11 servicios de arriba, estos dos **no se consultaron contra la AWS Price
List Bulk API** en esta sesión — no hay archivo JSON descargado ni URL de fuente que citar. Las
cifras usadas como referencia en `docs/cost/cost-model.md` §3.5.1/§3.5.2 ($5.00/millón de trazas
registradas + $0.50/millón recuperadas para X-Ray; sin cifra concreta para `GetMetricData`, cobrado
por métrica solicitada) provienen de memoria/documentación general de AWS, **no de una consulta
verificada como el resto de este documento**. Antes de comprometer estos números en un Gate,
repetir el mismo proceso que produjo las secciones 1-11: descargar el offer file de
`AWSXRay`/`AmazonCloudWatch` (el de `GetMetricData` específicamente, no solo el de logs/métricas
ya cubierto en la sección 6) para la región vigente y extraer el precio real.

---

## Preguntas abiertas para el humano

1. **WAF — discrepancia description vs. pricePerUnit en mx-central-1.** Los campos de texto ("$50 per Month", "$10 per Month", "$100 per Month") no coinciden con el campo numérico real de facturación (`pricePerUnit`: $5, $1, $10). Se reportó el valor de `pricePerUnit` por ser el campo que efectivamente se factura, pero **se recomienda confirmar manualmente en la AWS Pricing Calculator con región México (Central) seleccionada** antes de usar esta cifra en un presupuesto comprometido — si resultara que el precio real es 10x mayor, cambia significativamente el costo de WAF en el diseño multi-tenant.

2. **NAT Gateway — referencia de us-east-1 no verificada por descarga directa.** El archivo de precios de EC2 para us-east-1 (~480 MB) no pudo descargarse de forma estable en esta sesión. El valor $0.045/hora + $0.045/GB se tomó de la página oficial de precios vía búsqueda web (corroborado por múltiples fuentes, y es un precio históricamente estable), pero no se extrajo directamente del JSON de la Price List API como el resto de las cifras de este documento. Si se requiere presupuesto de alta precisión para us-east-1 como fallback real, vale la pena re-descargar y confirmar.

3. **CloudWatch Dashboards — precio no está en la Price List Bulk API.** El precio de $3.00/dashboard-mes solo existe en la página de marketing (`aws.amazon.com/cloudwatch/pricing`), no en los archivos JSON de precios por región. Es una tarifa global histórica y estable, pero al no existir un SKU verificable por región, técnicamente no se pudo confirmar con el mismo nivel de rigor que el resto de las cifras.

4. **RDS Multi-AZ con réplicas legibles ("Multi-AZ DB Cluster").** No hay pricing publicado para esta modalidad en `db.t4g.micro`, `db.t4g.medium` ni `db.m7g.large` en mx-central-1 — solo para instancias más grandes. Si el diseño de alta disponibilidad del SaaS requiere réplicas de lectura síncronas (no solo el Multi-AZ clásico de standby), **se necesita decidir un tipo de instancia mayor** o descartar esa modalidad para el tier de entrada.

5. **Disponibilidad "operativa" vs. "pricing publicado".** Los 11 servicios tienen archivos de precios propios para mx-central-1, lo cual es fuerte evidencia de disponibilidad, y para Cognito se confirmó explícitamente con el anuncio de lanzamiento regional de julio 2025. Para WAF, ALB, SQS, S3, Lambda, RDS, Fargate/ECS, CloudWatch, NAT Gateway y Secrets Manager no se buscó un anuncio de lanzamiento regional dedicado (son servicios "core" que típicamente acompañan cada región nueva desde el día uno). **¿Se acepta esta inferencia (pricing publicado = servicio disponible) o se requiere que el humano confirme cada uno manualmente en la consola de AWS antes de congelar la arquitectura?**

6. **¿Aceptamos que algún componente viva en otra región que los datos?** No se encontró ningún caso en esta investigación donde mx-central-1 careciera de un servicio de los 11 solicitados — por lo tanto, con la información disponible, **no habría necesidad de usar us-east-1 como región operativa real** para ningún componente de este stack. Esto es una buena noticia para la decisión de "todo en mx-central-1", pero como se indica en el punto 5, vale la pena una confirmación operativa final antes de cerrar el diseño de Fase 1.

   **Resuelto (ADR-018, 2026-07-31):** la "confirmación operativa final" que este punto pedía
   efectivamente reveló el problema que aquí se consideraba poco probable — `mx-central-1` es una
   región opt-in no habilitada por default en la cuenta sandbox real usada para el primer deploy
   de prueba. La plataforma migró completa a `us-east-1`. Todas las cifras de este documento
   (secciones 1-11) siguen siendo válidas como **precios de `mx-central-1`**, pero ya no
   representan la región operativa real — pendiente una nueva pasada de verificación contra
   `us-east-1` (alcance explícito de ADR-018: no se hizo como parte de ese cambio).

7. **X-Ray y `GetMetricData` (Fase 6) nunca se verificaron.** Ver sección 12 arriba — las cifras
   usadas en `cost-model.md` §3.5.1/§3.5.2 son de memoria, no de una consulta a la Price List API
   como el resto de este documento. Pendiente antes de comprometerlas en un Gate.
