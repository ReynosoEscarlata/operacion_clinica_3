# PLAN — Challenge 5: "Plataforma para todos"

**Nivel objetivo:** Arquitecto
**Punto de partida:** salida del Challenge 4 (monolito clínico roto en microservicios con strangler fig, comunicación por eventos + modo degradado, observabilidad y contract testing)
**Objetivo:** convertir la plataforma en un SaaS B2B multi-tenant production-ready en AWS, con IaC 100%, observabilidad real, plan de DR y compliance LFPDPPP.

---

## 0. Cómo leer este plan

Este documento es el **plan maestro**. No es el prompt para Claude Code: cada fase tiene su propio bloque de prompt al final, listo para pegar, y **ningún bloque se ejecuta hasta que el gate de la fase anterior está aprobado por ti**.

Regla que se mantiene del Challenge 4: **documentación primero, código después**. En este challenge la regla se endurece porque las decisiones de tenancy y de compliance son casi irreversibles: cambiar de `shared DB + tenant_id` a `DB-per-tenant` con 30 clínicas en producción es un proyecto de migración, no un refactor.

**Convenciones que se conservan:**
- Documentación, comentarios y commits en español. Código en inglés.
- Conventional Commits en español (`feat(tenancy): agrega middleware de contexto de tenant`).
- ADRs y RFCs versionados en el repo, con estado explícito.
- Diagramas en Mermaid dentro de los `.md`.

---

## 1. Supuestos sobre el Challenge 4 (confirmar antes de empezar)

Este plan asume el siguiente estado heredado. **Marca lo que sea falso**, porque cambia el alcance de la Fase 0:

| # | Supuesto | ¿Cierto? |
|---|---|---|
| S1 | Existen al menos 3 servicios independientes (p.ej. `appointments`, `notifications`, `identity/users`) con sus propios despliegues | |
| S2 | Cada servicio tiene su propio esquema/DB o al menos aislamiento lógico a nivel de esquema | |
| S3 | La comunicación asíncrona ya usa un broker (Redis/BullMQ) con patrón Outbox implementado | |
| S4 | Existe un contrato de eventos versionado y contract tests en CI | |
| S5 | La plataforma ya soporta múltiples clínicas a nivel de datos (`clinic_id` en las tablas), aunque no como tenancy formal | |
| S6 | Hay logging estructurado (Pino) con `correlation_id` propagado entre servicios | |
| S7 | Todo corre hoy fuera de AWS (local / Docker Compose / VPS) y no hay IaC previa | |

> **Nota importante:** si S5 es falso — es decir, si el modelo de datos actual no tiene una columna de tenant consistente en todas las tablas con PII — la Fase 3 crece de forma significativa (migración de datos + backfill + doble escritura). Dilo antes de aprobar el plan.

---

## 2. Decisiones bloqueantes (tú, antes de la Fase 0)

Estas seis decisiones no las toma Claude Code ni las tomo yo por ti. Son las que definen el resto del challenge. Cada una se documenta después como ADR, pero necesito tu inclinación inicial para calibrar las fases:

| # | Decisión | Opciones | Impacto si se cambia después |
|---|---|---|---|
| D1 | **Modelo de tenancy** | shared DB + `tenant_id` con RLS · schema-per-tenant · DB-per-tenant · híbrido (pool + silo para clínicas grandes) | Altísimo — migración de datos |
| D2 | **Compute** | ECS Fargate · Lambda · híbrido (Fargate para APIs, Lambda para workers/jobs) | Medio — reescritura de handlers y de IaC |
| D3 | **IaC** | AWS CDK (TypeScript, mismo lenguaje que el stack) · Terraform | Alto — rehacer la infra |
| D4 | **Región y residencia de datos** | `us-east-1` · `us-west-2` · `mx-central-1` (México) · multi-región | Alto — implicaciones de compliance y latencia |
| D5 | **Estructura de cuentas AWS** | una cuenta con 3 entornos · Organizations con cuenta por entorno (dev/staging/prod) | Medio-alto |
| D6 | **Presupuesto objetivo** | $/mes para 10 clínicas, y techo aceptable a 100 | Define D1 y D2 más que cualquier otra cosa |

**Mi recomendación por defecto**, si quieres arrancar sin trabarte (todas se debaten formalmente en la Fase 1):

- **D1: híbrido pool-first** — shared DB + `tenant_id` + Row Level Security de Postgres como default, con la puerta abierta a mover una clínica a esquema o instancia dedicada ("silo") cuando lo pida por contrato. Es el único modelo que sobrevive al criterio de "onboarding en <30 min" y al presupuesto a 1000 clínicas, y RLS te da una defensa a nivel de motor, no solo a nivel de ORM.
- **D2: híbrido** — Fargate para los servicios HTTP (ya son procesos Node de larga vida con BullMQ; portarlos a Lambda es fricción gratis), Lambda para jobs programados, provisioning de tenants y consumidores de SQS de bajo volumen.
- **D3: CDK en TypeScript** — mismo lenguaje que el stack, y el objetivo del challenge es arquitectura, no aprender HCL.
- **D4: `mx-central-1` si los servicios necesarios están disponibles ahí** — hay que verificarlo servicio por servicio (Cognito y algunos servicios gestionados no llegan a todas las regiones al mismo tiempo). Si Cognito no está disponible, la decisión es explícita: región de datos en México, plano de identidad en otra región, y eso se documenta en el aviso de privacidad como transferencia. Alternativa pragmática: `us-east-1` con la justificación de compliance escrita.
- **D5: Organizations con cuenta por entorno** — el aislamiento de prod es parte del threat model, no un lujo.
- **D6:** dime el número. Sin él, el cost model es ficción.

---

## 3. Mapa de fases

| Fase | Nombre | Entregables clave | Gate | Estado |
|---|---|---|---|---|
| 0 | Inventario y línea base | `baseline-challenge-4.md`, backlog de deuda | Aprobación del alcance | ✅ Completada |
| 1 | Diseño: tenancy, RBAC, amenazas, costos | RFC-003, RFC-004, threat model, ADR-005 a ADR-017 | **Gate mayor: nada se codifica antes** | ✅ Completada (RFC-003/004 y ADR-005–017 en estado *Aceptado*) |
| 2 | Fundación AWS + IaC | Landing zone, VPC, RDS, ECS, Cognito, Secrets, WAF | Infra reproducible desde cero en dev | ✅ Completada (`infra/`, CDK, validado con `cdk synth` — nunca desplegado) |
| 3 | Tenancy en el plano de datos | RLS, contexto de tenant, tests de aislamiento | Tests de aislamiento en verde en CI | ✅ Completada (los 5 servicios, `tests/isolation/`) |
| 4 | Identidad y RBAC | Cognito + claims + motor de permisos | Matriz de permisos probada | ✅ Completada (`@clinica/authz`, matriz de RFC-004 con `it.each`) |
| 5 | Compliance: audit log + retención | Audit log inmutable, data inventory, borrado | Auditoría de PII completa | ✅ Completada — ver "Estado de ejecución" abajo |
| 6 | Observabilidad y costos | Dashboards, alarmas, Cost Anomaly Detection | Dashboard ejecutivo funcionando | ✅ Completada — ver "Estado de ejecución" abajo |
| 7 | Resiliencia y DR | RFC-DR, game day de caída de AZ, runbooks | RTO/RPO demostrados | 🚧 Parcial (ADR-015 aceptado: backup & restore, RDS Single-AZ por defecto; game days pendientes) |
| 8 | Onboarding de tenant | Flujo/comando de provisioning | <30 min end-to-end, cronometrado | ⬜ Pendiente |
| 9 | Hardening y cierre | OWASP Top 10, CI/CD 3 entornos, C4 final | Evidencia de todos los criterios | ⬜ Pendiente |

Las fases 3–6 pueden solaparse parcialmente; las fases 1, 2 y 8 son secuenciales estrictas.

### Estado de ejecución — Fase 5 (última actualización)

Completada en 12 commits. Resumen de lo entregado (detalle en cada commit `feat(...)`/`docs(compliance)`):

- **Audit log inmutable** en los 5 servicios (`AuditLog` por servicio, append-only verificado con
  tests de integración contra Postgres real — `GRANT SELECT, INSERT` + `REVOKE UPDATE, DELETE`
  explícito para `app_role`, sin hash-chaining por ADR-013). Cubre login/refresh y CRUD de `User`
  (auth), la state machine y CRUD de `Patient` (appointments), create/addAvailability (doctors),
  procesamiento de webhooks (payments), y acceso a dead-letter (notifications — único caso donde se
  audita una lectura de lista, por ser acceso escalado de plataforma).
- **Hallazgo y fix**: `SupportAccessGrant` (Fase 4) no era realmente append-only —
  `GRANT SELECT, INSERT` nunca revocó el `UPDATE`/`DELETE` que la `ALTER DEFAULT PRIVILEGES` de la
  migración base ya le había otorgado a `app_role`. Corregido con un `REVOKE` explícito, mismo
  patrón aplicado a las 5 tablas `AuditLog` nuevas.
- **`docs/compliance/inventario-datos-personales.md`** y **`aviso-de-privacidad.md`**.
- **Retención (ADR-016)** implementada, no solo documentada: `retention-policy.ts` +
  `purge-expired-data.job.ts` (`--dry-run`) en appointments/payments/auth.
- **Derechos ARCO**: `GET/POST/PATCH /v1/patients/:id/arco-*`, con `optOut` propagado a
  Notifications para bloquear recordatorios (no transaccionales).
- **Redacción de PII en logs**: `redact` de Pino en los 5 servicios (`@clinica/audit-log`) + test
  parametrizado de fuga de PII + 2 fugas reales encontradas y corregidas (email en
  `EmailChannel`, `stripeCustomerId` en `PatientService`).
- **Retención de CloudWatch Logs**: ya estaba implementada por trabajo paralelo de Fase 6
  (`infra/config/environments.ts`, verificado con `cdk synth` — dev 7 días, staging 30, prod 90).

**Fuera de alcance de esta fase (ver el commit `docs(compliance)` para el detalle completo):**
job de export del `AuditLog` a S3 Object Lock (bucket ya provisionado, job no construido —
bloqueado por "nunca desplegar a AWS"); verificación de encriptación real en RDS/tráfico interno
(NO VERIFICADO, no hay infra desplegada); hash-chaining y retención configurable (ambos rechazados
conscientemente por ADR-013/ADR-016).

**Deuda no relacionada encontrada de paso:** `tests/contract/doctors-provider.pact.test.ts` falla
en `master` por un fixture de pact con fecha ya pasada (`2026-07-01`) respecto a la fecha simulada
del repo — no es de esta fase, queda para quien lo toque.

### Estado de ejecución — Fase 6 (última actualización)

Completada en 7 olas / commits (`feat(observability)`, `feat(cost)`, `feat(platform)`):

- **Ola 0** — `packages/observability` (paquete compartido entre los 6 procesos: `headers.ts`,
  `emf.ts`, `xray.ts`/`xray-plugin.ts`, `security-events.ts`), ADR-017 (borrador, luego finalizado
  en Ola 7), runbooks retroactivos para las alarmas de Fase 2 que nunca tuvieron uno.
- **Ola 1** — Correlación end-to-end: el gateway generaba `requestId` pero nunca lo reenviaba
  (backlog ítem 8, cerrado); `tenantId` agregado al mixin de los 6 loggers; propagación de
  `x-request-id` en las llamadas síncronas de Appointments a Doctors/Payments.
- **Ola 2** — Métricas RED vía CloudWatch EMF, dimensiones `[Service, Environment]` únicamente
  (nunca `tenantId` ni `route` — ver la aritmética de presupuesto de métricas en ADR-017).
- **Ola 3** — Tracing distribuido con AWS X-Ray: plugin (`aws-xray-sdk-fastify` oficial, modo
  manual), sidecar `xray-daemon` en las 6 task definitions, propagación de `X-Amzn-Trace-Id` en
  llamadas síncronas, retención de CloudWatch Logs por entorno (dev 7d/staging 30d/prod 90d,
  primera cifra concreta desde ADR-016).
- **Ola 4** — Dashboards RED + alarmas de edge (5xx, p95, anomalía de tráfico, WAF logging, ALB
  access logs) + RDS (CPU, storage, conexiones, DBLoad) + el metric filter de acceso cross-tenant
  (amenaza #3 del threat model) + construct `AlarmWithRunbook` (toda alarma exige un runbook que
  existe en disco, verificado por `infra/test/alarmas-tienen-runbook.test.ts`).
- **Ola 5** — Stack `Cost` nuevo pinneado a `us-east-1` (Budget movido desde `foundation-stack.ts`
  + Cost Anomaly Detection, imposible en `mx-central-1`), tags `ClinicService`/`Component`,
  `docs/cost/reporte-costo-por-tenant.md` + `scripts/costo-por-tenant.mjs`.
- **Ola 6** — Dashboard ejecutivo: `GET /v1/platform/dashboard` + `/v1/platform/metrics`
  (Appointments, 3 funciones SECURITY DEFINER nuevas para agregados cross-tenant) +
  `GET /v1/platform-users/active` (Auth, 1 función SECURITY DEFINER), permiso
  `platform_dashboard:read` nuevo en RFC-004/`@clinica/authz`, proxy en el gateway, página
  `PlatformDashboardPage.tsx` en el panel admin gateada por rol.
- **Ola 7** — Reconciliación de documentación (esta sección, `cost-model.md` §3.5 con X-Ray/
  GetMetricData, ADR-017 finalizado, `infra/README.md`/`deploy-infra.md` actualizados).

**Evento externo durante la ejecución — ADR-018:** a mitad de esta fase, una sesión paralela
(Fase 2, primer intento de deploy de prueba) descubrió que `mx-central-1` es una región opt-in no
habilitada en la cuenta sandbox real, y migró toda la plataforma a `us-east-1` (ADR-018, reemplaza
ADR-010). Esto no invalidó ninguna decisión de ADR-017 (X-Ray, EMF, dashboard, metric filter de
seguridad siguen siendo correctos independientemente de la región) y de hecho resolvió por
completo la excepción de región que el stack `Cost` necesitaba — desde ADR-018, `us-east-1` ya no
es una excepción, es la región de todo el proyecto. **Pendiente, fuera de alcance de esta fase:**
`docs/cost/cost-model.md` y `docs/cost/precios-aws-consultados.md` siguen calculados sobre precios
de `mx-central-1` (marcado explícitamente en ambos documentos) — una nueva pasada de verificación
de precios contra `us-east-1` queda para quien retome el cost model.

**Fuera de alcance de esta fase:** redacción real de PII en logs (dependencia de Fase 5, ya
resuelta en paralelo); precio verificado de X-Ray y `GetMetricData` (**NO VERIFICADO**, nunca se
consultó la Price List API real para estos dos); umbrales de alarma (error rate, p95, conexiones
RDS) calibrados sin tráfico real, marcados explícitamente como valores de arranque a recalibrar.

**Sobre "por tenant y agregado" del criterio de aceptación (Alcance, punto 4):** el DoD se cumple
combinando dos vistas, no una sola pantalla con ambos ejes simultáneos: el dashboard *por-tenant*
ya existe desde Fase 3 (`GET /v1/admin/dashboard`, `DashboardPage.tsx`, scoped por RLS) y el
dashboard *agregado* es lo nuevo de esta fase (`GET /v1/platform/dashboard`,
`PlatformDashboardPage.tsx`). El drill-down por tenant de error-rate/p95 (las dos métricas
técnicas del criterio) es una consulta de CloudWatch Logs Insights, no un tercer valor graficado
en la vista agregada — decisión consciente para proteger el presupuesto de métricas custom (ver
ADR-017, "por qué no `tenantId` como dimensión").

---

# FASE 0 — Inventario y línea base

**Objetivo:** saber exactamente qué heredas antes de decidir sobre eso.

### Actividades
1. Inventario de servicios: nombre, responsabilidad, dependencias, endpoints, jobs, tablas propias.
2. Inventario de datos: **toda** columna que contenga PII o datos de salud, con su tabla y servicio dueño. Esto alimenta la Fase 1 (threat model) y la Fase 5 (data inventory) — hazlo bien una vez.
3. Inventario de estado compartido: caches, colas, buckets, cron jobs, feature flags.
4. Deuda técnica heredada del Challenge 4, clasificada en *bloquea multi-tenancy* / *bloquea producción* / *puede esperar*.
5. Métricas de línea base actuales: p95 de los endpoints principales, tamaño de DB, throughput de eventos.

### Entregables
- `docs/baseline-challenge-4.md` con las cinco tablas anteriores.
- `docs/backlog-deuda.md` priorizado.

### Definition of Done
- Ninguna tabla del modelo de datos queda sin clasificar respecto a PII.
- Cada servicio tiene identificado su dueño de datos (no hay tablas escritas por dos servicios).

### Gate 0
Yo reviso el inventario de PII contigo antes de la Fase 1. Es el insumo del threat model y de la mitad del compliance.

### Prompt para Claude Code — Fase 0

```
Contexto: este repo es el resultado del Challenge 4 (monolito de gestión de citas clínicas
extraído a microservicios). Vamos a convertirlo en un SaaS multi-tenant en AWS.

Tarea: generar un inventario de línea base. NO modifiques código de aplicación en esta fase.

1. Recorre el repo y produce docs/baseline-challenge-4.md con estas secciones:
   - Servicios: tabla (nombre, responsabilidad, puerto, dependencias externas, tablas propias,
     jobs/workers, endpoints HTTP expuestos).
   - Modelo de datos: tabla (tabla, columna, tipo, ¿contiene PII?, ¿dato sensible de salud?,
     servicio dueño, ¿tiene columna de clinic/tenant?). Clasifica CADA columna. Marca como
     "REVISAR" las que no puedas determinar con certeza en lugar de adivinar.
   - Estado compartido: caches Redis, colas BullMQ, buckets, cron jobs, variables de entorno
     compartidas entre servicios.
   - Contratos de eventos: lista de eventos publicados/consumidos con su versión y su payload.
   - Flujos críticos: diagrama Mermaid de secuencia para (a) creación de cita, (b) envío de
     notificación, (c) autenticación de usuario.

2. Produce docs/backlog-deuda.md: deuda técnica encontrada, clasificada en
   [BLOQUEA-MULTITENANCY] / [BLOQUEA-PRODUCCION] / [PUEDE-ESPERAR], con una línea de
   justificación cada una.

Restricciones:
- Documentación en español, identificadores de código en inglés.
- No propongas soluciones todavía. Esta fase es solo diagnóstico.
- Si una respuesta requiere suposiciones, escríbela en una sección "Supuestos y preguntas
  abiertas" al final del documento en lugar de asumirla en silencio.
- Commit: docs(baseline): agrega inventario de línea base post-challenge-4
```

---

# FASE 1 — Diseño (el corazón del challenge)

**Objetivo:** todas las decisiones mayores tomadas, justificadas y documentadas antes de escribir una línea de IaC. Esta fase es el 40% del challenge y es la que define tu nivel de arquitecto.

**Esta fase la trabajamos tú y yo. Claude Code solo genera esqueletos y hace investigación de precios.**

## 1.1 RFC-tenancy.md

Comparación obligatoria de los tres modelos. Ejes de comparación mínimos:

| Eje | shared DB + tenant_id | schema-per-tenant | DB-per-tenant |
|---|---|---|---|
| Costo a 10 / 100 / 1000 clínicas | | | |
| Aislamiento (blast radius de un bug de query) | | | |
| Riesgo de fuga cruzada de datos | | | |
| Tiempo de onboarding | | | |
| Complejidad de migraciones de esquema | | | |
| Granularidad de backup y restore por cliente | | | |
| Noisy neighbor / QoS | | | |
| Límites duros de Postgres (conexiones, nº de esquemas, nº de tablas) | | | |
| Compliance: borrado de datos de un tenant | | | |
| Portabilidad: exportar/salir un cliente | | | |
| Esfuerzo de implementación en el código actual | | | |

**Contenido adicional obligatorio del RFC:**
- Decisión final con justificación cuantitativa (referencia explícita al cost model).
- Estrategia de **propagación del contexto de tenant**: de dónde sale el `tenant_id` (claim de JWT, nunca un header ni un query param manipulable por el cliente), cómo viaja por HTTP, cómo viaja en el envelope de los eventos, cómo llega al pool de conexiones.
- Estrategia de **enforcement**: RLS en Postgres + middleware + repositorio base que exige tenant. Defensa en profundidad, tres capas, con la premisa de que el ORM va a fallar algún día.
- **Ruta de escape**: cómo se promueve una clínica de pool a silo sin downtime. Incluso si nunca se ejecuta, tener la ruta escrita es lo que distingue un diseño de una apuesta.
- Qué es explícitamente **cross-tenant** por diseño: catálogo de especialidades, plantillas de notificación, plano de control, métricas agregadas.

## 1.2 RFC-rbac.md

Debe distinguir **dos planos de autorización** — es el error más común en SaaS B2B:

- **Plano de plataforma:** `platform_admin`, `platform_support` (acceso cross-tenant, con auditoría reforzada y justificación obligatoria).
- **Plano de tenant:** `clinic_owner`, `clinic_admin`, `doctor`, `receptionist`, `patient`.

Contenido mínimo:
- Modelo elegido: RBAC plano · RBAC con herencia · RBAC + ABAC para reglas de propiedad del recurso (p.ej. "un médico solo ve las citas de sus pacientes"). Documenta por qué RBAC puro no alcanza para el caso del médico.
- Catálogo de permisos con granularidad `recurso:acción` (`appointment:read`, `appointment:cancel`, `patient:read_medical_history`, `audit:read`).
- **Matriz rol × permiso completa** — esta matriz es después el fixture de los tests de autorización.
- Reglas de scope: tenant, clínica-sucursal (si aplica), propiedad del recurso.
- Roles personalizados por tenant: ¿se permiten en v1? (recomendación: no, pero el esquema debe soportarlos).
- Autorización servicio-a-servicio: cómo se distingue una llamada interna de una del usuario final, y por qué un servicio interno **no** debe poder omitir el filtro de tenant.
- Escalada de privilegios: cómo un `platform_support` accede a datos de un tenant (acceso temporal, con expiración, con motivo registrado, con notificación al tenant).

## 1.3 threat-model.md (STRIDE)

Alcance: **el data flow de PII y de datos de salud**, de punta a punta.

1. Diagrama de flujo de datos (Mermaid) con **trust boundaries** explícitos: internet → WAF/ALB → servicios → RDS / SQS / S3 / Cognito / Resend / Stripe.
2. Tabla STRIDE por cada elemento cruzado por PII:

| Elemento | Amenaza | Categoría STRIDE | Impacto | Probabilidad | Mitigación | ¿Implementada en qué fase? |
|---|---|---|---|---|---|---|

3. Amenazas que **no** puedes omitir en un multi-tenant de salud:
   - `tenant_id` manipulable desde el cliente → *Spoofing / Elevation*.
   - Query sin filtro de tenant en un endpoint nuevo → *Information Disclosure*.
   - IDOR sobre IDs secuenciales de paciente o de cita → *Information Disclosure*.
   - Evento publicado sin `tenant_id` y consumido en el contexto equivocado → *Information Disclosure*.
   - Cache Redis con clave sin namespace de tenant → *Information Disclosure*.
   - Presigned URL de S3 con expiración larga o path predecible → *Information Disclosure*.
   - Empleado de plataforma consultando la DB de prod → *Elevation / Repudiation*.
   - Log estructurado que imprime PII en CloudWatch → *Information Disclosure* (el más frecuente en la práctica).
   - Borrado de audit log para tapar un acceso → *Repudiation*.
   - Backup restaurado en entorno de dev con datos reales → *Information Disclosure*.
   - Notificación enviada al paciente equivocado por colisión de tenant → *Information Disclosure*.
4. Riesgo residual aceptado, firmado y con fecha de revisión.

> Nota de contexto legal, relevante para calibrar la severidad: bajo la LFPDPPP los datos de salud son **datos personales sensibles**, y las sanciones se duplican cuando la infracción involucra este tipo de datos. Cualquier amenaza que exponga historial clínico entra automáticamente en la banda de severidad más alta.

## 1.4 cost-model.xlsx

Escenarios: **10, 100 y 1000 clínicas**. Supuestos explícitos por escenario (médicos por clínica, pacientes activos, citas/día, notificaciones/cita, MB de adjuntos/paciente, requests/día).

Hojas mínimas:
1. `Supuestos` — todas las variables de entrada, en celdas editables.
2. `Unit economics` — costo por clínica y por cita, derivado.
3. `Escenario-10`, `Escenario-100`, `Escenario-1000` — desglose por servicio: Fargate/Lambda, RDS (instancia + storage + IOPS + Multi-AZ + backups), SQS, S3 (storage + requests + transferencia), CloudWatch (**logs ingestados es la sorpresa clásica**), Cognito MAU, ALB/WAF, NAT Gateway, Secrets Manager, transferencia entre AZ.
4. `Comparativa-tenancy` — el mismo escenario bajo los tres modelos de D1. Esta hoja es la que sustenta el RFC-tenancy.
5. `Sensibilidad` — qué pasa si el tráfico se duplica, si RDS pasa a la siguiente talla, si activas multi-región.

Reglas: cada número lleva su fuente (AWS Pricing Calculator o página de precios del servicio, con fecha de consulta). Nada de cifras de memoria — los precios cambian y un cost model sin fuentes no es defendible.

## 1.5 ADRs (mínimo 8 — propongo 12)

| ADR | Decisión |
|---|---|
| ADR-001 | Modelo de tenancy |
| ADR-002 | Enforcement de aislamiento: RLS + middleware + repositorio base |
| ADR-003 | Compute: ECS Fargate vs Lambda vs híbrido |
| ADR-004 | Herramienta de IaC: CDK vs Terraform |
| ADR-005 | Estructura de cuentas y entornos AWS |
| ADR-006 | Región y residencia de datos (LFPDPPP) |
| ADR-007 | Identidad: Cognito user pool compartido vs pool por tenant |
| ADR-008 | Modelo de autorización: RBAC + ABAC, y dónde vive el motor de permisos |
| ADR-009 | Almacenamiento del audit log e inmutabilidad (S3 Object Lock vs tabla append-only vs QLDB-like) |
| ADR-010 | Estrategia de mensajería: SQS vs mantener Redis/BullMQ vs coexistencia |
| ADR-011 | Objetivos de DR: RTO/RPO y estrategia (pilot light vs warm standby) |
| ADR-012 | Estrategia de retención y borrado de datos personales |

Todos con la plantilla del Anexo A del challenge, mínimo 3 opciones reales consideradas (una opción de relleno se nota), y sección de *Cosas a monitorear* concreta.

## 1.6 Diagramas C4

- **Nivel 1 (Contexto):** la plataforma, los tipos de usuario, los sistemas externos (Stripe, Resend, Cognito).
- **Nivel 2 (Contenedores):** servicios, RDS, SQS, S3, ALB/WAF, plano de control de tenants.
- **Nivel 3 (Componentes):** al menos para `appointments` y para el nuevo `tenant-provisioning`, mostrando dónde se aplica el filtro de tenant y dónde se escribe el audit log.

### Gate 1 — el gate mayor
No se escribe IaC ni código hasta que: los 3 RFCs estén en estado *Aceptado*, los 12 ADRs escritos, el threat model tenga mitigación asignada a una fase para toda amenaza de severidad alta, y el cost model esté dentro del presupuesto D6.

### Prompt para Claude Code — Fase 1

```
Fase 1 del Challenge 5: DISEÑO. En esta fase NO se escribe código de aplicación ni IaC.

Tarea: generar los ESQUELETOS de los documentos de diseño y hacer la investigación de datos
que los sustenta. Las DECISIONES las toma el humano; tú preparas el material para decidir.

1. Crea docs/rfc/RFC-002-tenancy.md con:
   - Secciones: Contexto, Requisitos (funcionales, de compliance, de costo), Opciones,
     Comparativa, Decisión (déjala VACÍA con el marcador "PENDIENTE DE DECISIÓN HUMANA"),
     Propagación de contexto de tenant, Estrategia de enforcement, Ruta pool→silo,
     Datos cross-tenant por diseño, Riesgos, Preguntas abiertas.
   - La tabla comparativa DEBE cubrir los ejes definidos en el plan maestro (sección 1.1),
     rellenada con análisis técnico basado en el código real de este repo, no en genéricos.
     Donde el costo importe, remite a cost-model y deja el número como "[ver cost-model]".
   - Incluye, para cada opción, el diff conceptual concreto sobre el código actual: qué
     archivos de este repo cambiarían y cómo.

2. Crea docs/rfc/RFC-003-rbac.md con el catálogo de permisos derivado de los endpoints REALES
   del repo (recorre las rutas y deriva un permiso recurso:acción por cada una). Incluye la
   matriz rol × permiso con los roles: platform_admin, platform_support, clinic_owner,
   clinic_admin, doctor, receptionist, patient. Marca con "?" las celdas que requieran decisión
   del humano en lugar de asumir.

3. Crea docs/security/threat-model.md con STRIDE. Diagrama de flujo de datos en Mermaid con
   trust boundaries. Usa el inventario de PII de docs/baseline-challenge-4.md como entrada:
   toda columna marcada como PII debe aparecer en al menos una fila del análisis. Incluye
   obligatoriamente las 11 amenazas listadas en la sección 1.3 del plan maestro.

4. Crea docs/adr/ con los 12 ADRs numerados, usando la plantilla de docs/adr/TEMPLATE.md
   (créala según el Anexo A del challenge). Cada ADR con Contexto y Opciones REDACTADAS y
   con pros/contras reales, y con Decisión y Consecuencias vacías marcadas
   "PENDIENTE DE DECISIÓN HUMANA".

5. Crea docs/diagrams/c4-nivel-1.md y c4-nivel-2.md en Mermaid, reflejando el estado ACTUAL
   del repo más los componentes AWS que el plan contempla, marcando los nuevos como
   "(propuesto)".

6. Investigación de costos: crea docs/cost/precios-aws-consultados.md con los precios unitarios
   vigentes de: Fargate (vCPU-hora, GB-hora), Lambda (GB-s, requests), RDS Postgres (tallas
   t4g/m7g relevantes, storage gp3, IOPS, Multi-AZ, backup), SQS, S3 (Standard, requests,
   transferencia), CloudWatch (logs ingestados, logs almacenados, métricas custom, dashboards),
   Cognito (MAU), ALB (LCU), WAF (WebACL, reglas, requests), NAT Gateway, Secrets Manager.
   Para la región que indique el humano. CADA precio con URL de fuente y fecha de consulta.
   Si no puedes acceder a la fuente, escribe "NO VERIFICADO" en lugar de un número de memoria.

Restricciones:
- NUNCA decidas el modelo de tenancy, el modelo de RBAC, la región ni los objetivos de RTO/RPO.
- Todo documento incluye al final "Preguntas abiertas para el humano" con lo que necesitas.
- Si modificas spec.md, mantén su changelog.
- Documentación en español. Un commit por documento, Conventional Commits en español.
```

---

# FASE 2 — Fundación AWS + IaC

**Objetivo:** infra reproducible desde cero con un comando, en el entorno dev.

### Alcance
1. **Landing zone**: Organizations, cuentas dev/staging/prod, SCPs básicas (denegar regiones no aprobadas, denegar borrado de CloudTrail), CloudTrail organizacional, IAM Identity Center.
2. **Red**: VPC con 3 AZs, subredes públicas/privadas/aisladas, NAT (evaluar 1 NAT vs 3 — decisión de costo vs disponibilidad, documentar), VPC endpoints para S3/SQS/Secrets Manager (ahorro real de NAT).
3. **Datos**: RDS Postgres Multi-AZ, parameter group con `rls` habilitado y logging de conexiones, cifrado con KMS CMK, backups automáticos + snapshots, Performance Insights.
4. **Compute**: cluster ECS Fargate, task definitions por servicio, service discovery, autoscaling por CPU y por profundidad de cola.
5. **Mensajería**: colas SQS + DLQ por consumidor, con política de reintentos.
6. **Almacenamiento**: buckets S3 (adjuntos, audit log, backups) con versionado, cifrado, política de acceso público bloqueada, lifecycle rules.
7. **Identidad**: Cognito user pool(s) según ADR-007, con `tenant_id` como atributo custom y un pre-token-generation trigger que lo inyecte al JWT.
8. **Secretos**: Secrets Manager con rotación para credenciales de RDS; Parameter Store para configuración no sensible.
9. **Perímetro**: ALB + WAF (managed rules de AWS: Core, SQLi, Known Bad Inputs) + rate limiting por IP y por tenant.

### Definition of Done
- `cdk deploy` (o `terraform apply`) levanta el entorno dev completo desde cero en una cuenta vacía.
- `cdk destroy` lo borra sin recursos huérfanos.
- Cero recursos creados a mano en la consola. Cero secretos en el repo.
- Todo recurso etiquetado con `Environment`, `Service`, `CostCenter`, `ManagedBy=IaC`.

### Gate 2
Demostración: destruir dev y recrearlo desde cero. Si requiere un paso manual, no está terminado.

### Prompt para Claude Code — Fase 2

```
Fase 2: FUNDACIÓN DE INFRAESTRUCTURA. Los ADRs 003, 004, 005, 006 y 007 están aprobados
(léelos en docs/adr/ antes de empezar y respétalos al pie de la letra; si algo del plan
contradice un ADR aprobado, PARA y pregunta).

Tarea: crear el repo de IaC en infra/ implementando la fundación.

Estructura esperada:
  infra/
    bin/            punto de entrada por entorno
    lib/stacks/     network, database, compute, messaging, storage, identity, edge, observability
    lib/constructs/ constructs reutilizables (servicio Fargate, cola con DLQ, bucket seguro)
    config/         configuración por entorno (dev/staging/prod), sin secretos

Requisitos:
- 100% de la infra en código. Cero recursos manuales.
- Un construct reutilizable "ClinicService" que encapsule task definition + service + target
  group + autoscaling + log group + alarmas base, para no repetirlo por servicio.
- Todo bucket S3: cifrado, versionado, block public access, TLS obligatorio por política.
- RDS: Multi-AZ, cifrado con CMK, en subredes aisladas, security group que solo acepta desde
  los security groups de las tasks, `rds.force_ssl=1`, backups con retención según ADR-011.
- Cognito: atributo custom tenant_id + Lambda de pre-token-generation que inyecta tenant_id y
  roles al JWT. El tenant_id NUNCA se acepta desde un header o body del cliente.
- WAF con AWS managed rule groups + regla de rate limiting. Adjuntado al ALB.
- Etiquetado obligatorio (Environment, Service, CostCenter, ManagedBy) aplicado a nivel de stack.
- Nada de credenciales en el código: Secrets Manager con rotación para RDS.

Entrega también:
- infra/README.md: prerequisitos, bootstrap, comando de deploy por entorno, cómo destruir.
- docs/runbooks/deploy-infra.md
- Diagrama Mermaid de la infra resultante en docs/diagrams/c4-nivel-2.md (actualiza el existente
  y anota el cambio en su changelog).

Restricciones:
- NO despliegues nada. Solo genera el código y valida con `cdk synth` (o `terraform validate`
  + `plan` contra un backend local). El humano ejecuta el deploy.
- NO toques todavía el código de aplicación: esta fase es solo infra.
- Si un servicio no está disponible en la región del ADR-006, PARA y reporta en lugar de
  cambiar la región por tu cuenta.
- Commits atómicos por stack. Conventional Commits en español.
```

---

# FASE 3 — Tenancy en el plano de datos

**Objetivo:** que sea *estructuralmente difícil* escribir una query que cruce tenants.

### Alcance
1. Migración de esquema: `tenant_id` NOT NULL en toda tabla con datos de tenant, con índices compuestos `(tenant_id, ...)` en todos los accesos frecuentes.
2. **Row Level Security** en Postgres: políticas por tabla, rol de aplicación sin `BYPASSRLS`, `SET LOCAL app.current_tenant` por transacción.
3. Contexto de tenant en la aplicación: extracción desde el claim del JWT → almacenamiento en contexto asíncrono (`AsyncLocalStorage`) → aplicación automática en la capa de repositorio.
4. Interacción con el pool de conexiones: `SET LOCAL` dentro de transacción, nunca `SET` a nivel de sesión (una conexión reutilizada con el tenant equivocado es la fuga clásica).
5. Eventos: `tenant_id` obligatorio en el envelope, validado en publicación y en consumo. Un consumidor que recibe un evento sin `tenant_id` lo manda a DLQ, no lo procesa "por si acaso".
6. Namespacing de claves en Redis y de prefijos en S3 por tenant.
7. **Tests de aislamiento automatizados** — este es el criterio de aceptación más importante del challenge:
   - Para **cada** endpoint: el tenant A autenticado no puede leer, modificar ni borrar un recurso del tenant B (esperado: 404, no 403 — el 403 confirma la existencia del recurso).
   - Test de enumeración: iterar IDs del tenant B con el token de A.
   - Test a nivel de DB: con el rol de aplicación y el contexto del tenant A, un `SELECT *` sin `WHERE` devuelve cero filas de B.
   - Test de eventos: un evento de A no produce efectos en B.
   - Test de cache: colisión de claves entre tenants.
   - **Test meta**: un test que recorre las rutas registradas y falla si alguna no está cubierta por un test de aislamiento. Sin esto, el sexto endpoint nuevo se queda sin probar.

### Definition of Done
- Suite de aislamiento en CI, bloqueante para el merge.
- Ninguna query de producción sin filtro de tenant (verificado con RLS activo en el entorno de test).

### Prompt para Claude Code — Fase 3

```
Fase 3: AISLAMIENTO DE DATOS MULTI-TENANT. ADR-001 y ADR-002 aprobados: lee ambos primero.

Tarea: implementar el aislamiento por tenant en defensa en profundidad (3 capas) y su suite
de pruebas.

Capa 1 — Base de datos:
- Migración: tenant_id UUID NOT NULL en todas las tablas de datos de tenant (usa
  docs/baseline-challenge-4.md para saber cuáles). Índices compuestos con tenant_id primero.
- Row Level Security: habilita RLS y FORCE ROW LEVEL SECURITY en cada tabla, política que
  compara tenant_id con current_setting('app.current_tenant'). Crea un rol de aplicación SIN
  BYPASSRLS y un rol de migración separado.
- Migraciones reversibles con backfill seguro para datos existentes. Documenta el plan de
  ejecución (¿requiere ventana de mantenimiento? ¿doble escritura?) en
  docs/runbooks/migracion-tenant-id.md antes de escribirla.

Capa 2 — Aplicación:
- TenantContext con AsyncLocalStorage, poblado por un middleware que lee el claim tenant_id del
  JWT verificado. Si no hay tenant_id, la request falla con 401. NUNCA leas tenant_id de header,
  query o body.
- Repositorio base que abre transacción y ejecuta SET LOCAL app.current_tenant antes de
  cualquier query. Prohibido SET a nivel de sesión: rompe con connection pooling.
- Refactoriza los repositorios existentes para heredar del base. Si algún acceso a datos no
  puede pasar por ahí, documéntalo en una lista de excepciones justificadas.

Capa 3 — Mensajería y cache:
- tenant_id obligatorio en el envelope de eventos, validado en publish y en consume. Evento sin
  tenant_id → DLQ, nunca procesamiento parcial.
- Claves Redis con prefijo tenant:{id}:. Prefijos S3 con tenant/{id}/.

Tests de aislamiento (tests/isolation/):
- Fixture con dos tenants poblados y usuarios de cada uno.
- Por CADA endpoint: acceso cruzado devuelve 404 (no 403 — no filtres existencia).
- Test de enumeración de IDs.
- Test a nivel de DB: con contexto del tenant A, SELECT sin WHERE no devuelve filas de B.
- Test de propagación en eventos y de colisión de claves de cache.
- Test META: recorre las rutas registradas de la app y FALLA si alguna no tiene un test de
  aislamiento asociado.

Restricciones:
- La suite de aislamiento debe ser bloqueante en CI.
- NO ejecutes migraciones contra ninguna base de datos remota. Solo local/test.
- Si encuentras una tabla con PII sin dueño claro de tenant, PARA y pregunta.
- Comentarios y commits en español, código en inglés.
```

---

# FASE 4 — Identidad y RBAC

### Alcance
1. Integración de Cognito según ADR-007, con `tenant_id` y roles en el JWT.
2. Motor de permisos: función `can(user, action, resource)` con RBAC + reglas ABAC de propiedad (el médico y sus pacientes).
3. Middleware de autorización declarativo por ruta (`requirePermission('appointment:cancel')`).
4. Autorización servicio-a-servicio distinguible de la del usuario final, sin capacidad de omitir el filtro de tenant.
5. Acceso de soporte de plataforma: temporal, con expiración, con motivo obligatorio, auditado y notificado al tenant.
6. Tests: la matriz rol × permiso del RFC-003 convertida en tabla parametrizada. Cada celda es un test.

### Definition of Done
- Toda ruta tiene un permiso declarado; una ruta sin declaración falla el arranque (fail-closed).
- La matriz completa está cubierta por tests, incluidos los casos negativos.

---

# FASE 5 — Compliance: audit log inmutable y retención LFPDPPP

**Contexto legal relevante (verificar vigencia antes de redactar los documentos):** la LFPDPPP vigente es la publicada en el DOF el 20 de marzo de 2025, que abrogó la ley de 2010. El INAI se extinguió y la autoridad en materia de datos personales del sector privado es ahora la Secretaría Anticorrupción y Buen Gobierno. A julio de 2026 el reglamento de la nueva ley sigue pendiente, por lo que el reglamento de 2011 aplica de forma supletoria en lo que no contradiga la ley nueva. La ley introduce expresamente la figura del **plazo de conservación** de los datos, lo que hace de la retention policy un requisito directo y no una buena práctica opcional. Los datos de salud son datos sensibles: consentimiento expreso y sanciones agravadas.

**Implicación de diseño:** dado que el reglamento no existe todavía, documenta tus decisiones de retención con su justificación y su fecha de revisión, de modo que cuando el reglamento se publique el cambio sea un ajuste de configuración y no un rediseño. Anótalo como riesgo en el ADR-012.

### Alcance
1. **Audit log inmutable** de toda acción que toque PII:
   - Campos: `timestamp`, `tenant_id`, `actor_id`, `actor_role`, `action`, `resource_type`, `resource_id`, `ip`, `user_agent`, `correlation_id`, `result`, `justification` (obligatoria para acceso de plataforma).
   - Inmutabilidad real: tabla append-only sin permisos de UPDATE/DELETE para el rol de aplicación **+** exportación a S3 con Object Lock en modo compliance **+** encadenamiento por hash de cada registro con el anterior, para detectar manipulación.
   - Escritura garantizada: si el audit log falla, la operación falla. Un acceso a PII sin registro de auditoría no es aceptable.
   - Consulta: los admins de tenant ven su propia auditoría; nadie puede borrarla.
2. **Data inventory** (`docs/compliance/inventario-datos-personales.md`): por cada dato personal — qué es, dónde vive (tabla/bucket/log/servicio externo), base legal, finalidad, quién accede, cuánto se conserva, cómo se borra, a quién se transfiere (Resend, Stripe: son transferencias y deben aparecer).
3. **Retention policy** implementada, no solo escrita: jobs de purga por categoría de dato, con dry-run, reporte y borrado en cascada verificable (incluidos backups, adjuntos S3 y logs de CloudWatch — el caso que casi todos olvidan).
4. **Derechos del titular (ARCO)**: flujo de acceso, rectificación, cancelación y oposición, con SLA y evidencia de atención.
5. Aviso de privacidad, minimización de PII en logs (redactor obligatorio en Pino), cifrado en tránsito y en reposo.
6. **Test de no-filtración de PII en logs**: escanea los logs generados por la suite de tests buscando patrones de PII y falla si encuentra alguno.

### Definition of Done
- Toda operación identificada como toque de PII en la Fase 0 genera un registro de auditoría, verificado por test.
- El borrado de un tenant deja evidencia auditable y no deja PII en ningún sistema, incluidos backups (o documenta explícitamente la ventana de retención de backups como riesgo aceptado con su fundamento).

---

# FASE 6 — Observabilidad y control de costos

### Alcance
1. Métricas: RED (rate, errors, duration) por servicio y **por tenant** (dimensión `tenant_id` en métricas custom — cuidado, el costo de métricas custom crece con la cardinalidad; evalúa EMF o agregación por tier de tenant en lugar de por tenant individual a partir de cierto número).
2. Logs estructurados hacia CloudWatch Logs con retención definida por entorno y sin PII.
3. Trazas distribuidas (X-Ray o OTel) con propagación de `correlation_id` y `tenant_id`.
4. **Dashboard ejecutivo** (criterio de aceptación): usuarios activos, citas por día, tasa de errores, latencia p95. Por tenant y agregado.
5. Dashboards operativos: salud por servicio, profundidad de colas y DLQs, conexiones y slow queries de RDS, saturación de Fargate.
6. Alarmas con destino y severidad: p95 por encima de umbral, tasa de errores 5xx, mensajes en DLQ, CPU/almacenamiento de RDS, fallos de escritura del audit log, **intentos de acceso cross-tenant detectados** (esta alarma es la que demuestra que entendiste el problema).
7. Costos: Cost Allocation Tags activadas, AWS Budgets con alertas por entorno, **Cost Anomaly Detection** configurado (criterio de aceptación), y un reporte mensual de costo por tenant contra el cost model.

### Definition of Done
- El dashboard ejecutivo responde a las cuatro métricas del criterio de aceptación sin intervención manual.
- Toda alarma tiene un runbook enlazado. Una alarma sin runbook es ruido.

---

# FASE 7 — Resiliencia y DR

### 7.1 RFC-disaster-recovery.md
- **RTO y RPO por clase de servicio** (no un número único: la API de citas y el envío de recordatorios no tienen el mismo objetivo).
- Escenarios cubiertos: caída de una AZ, caída de una región, corrupción de datos, borrado accidental de un tenant, compromiso de credenciales, fallo de un proveedor externo (Stripe/Resend).
- Estrategia elegida (backup & restore · pilot light · warm standby · activo-activo) con su costo tomado del cost model. La estrategia de DR es una decisión de presupuesto disfrazada de decisión técnica: haz explícito el costo.
- Estrategia de backup: automated backups + snapshots, cross-region copy, PITR, cifrado, y **prueba de restore** — un backup no probado no es un backup.
- Matriz de dependencias: qué se cae si se cae cada componente.

### 7.2 Verificación práctica
- **Game day 1 — caída de AZ** (criterio de aceptación): simular con failover de RDS Multi-AZ + drenar las tasks de una AZ. Medir el impacto real: requests perdidas, tiempo de recuperación, mensajes en DLQ. Documentar el resultado con evidencia, incluido lo que salió mal.
- **Game day 2 — restore desde backup**: restaurar a un punto en el tiempo en un entorno aislado y verificar integridad. Cronometrar contra el RTO declarado.
- **Game day 3 — pérdida de un servicio**: verificar que el modo degradado del Challenge 4 sigue funcionando en AWS.

### 7.3 Runbooks
`docs/runbooks/`: `failover-az.md`, `failover-region.md`, `restore-desde-backup.md`, `incident-response.md`, `onboarding-tenant.md`, `offboarding-tenant.md`, `acceso-soporte-a-datos-de-tenant.md`, `rotacion-de-secretos.md`.

Formato de runbook: síntoma → diagnóstico → decisión → pasos (comandos exactos, copiables) → verificación → comunicación → post-mortem. Escrito para ser ejecutado a las 3 de la mañana por alguien que no lo escribió.

---

# FASE 8 — Onboarding de tenant (<30 minutos)

**Criterio de aceptación:** una clínica nueva se onboardea con un comando o flujo de admin en menos de 30 minutos end-to-end.

### Alcance
1. Servicio/plano de control `tenant-provisioning`: crea el registro de tenant, el usuario owner en Cognito, la configuración por defecto, la marca (logo, color primario, nombre), las plantillas de notificación, y siembra los catálogos.
2. **Idempotencia y transaccionalidad**: si el paso 5 falla, no queda un tenant a medias. Saga con compensación o provisioning declarativo reconciliado.
3. Interfaz: comando CLI (`npm run tenant:create -- --config clinica.json`) **y** flujo en el panel de admin de plataforma. El CLI es lo que hace demostrable el criterio.
4. Configuración por tenant: horarios, especialidades, políticas de cancelación y reembolso, límites de uso, plan de suscripción.
5. Personalización de marca respetando la estética clínica (fondo blanco, acento azul configurable por tenant, texto negro, Inter, sin gradientes).
6. Offboarding: exportación completa de datos del tenant (portabilidad) + borrado verificable.
7. **Prueba cronometrada** del criterio, con evidencia: log con marcas de tiempo de inicio a fin, incluida la primera cita creada por la clínica nueva.

---

# FASE 9 — Hardening y cierre

### 9.1 OWASP Top 10 auto-aplicado
`docs/security/owasp-top10.md` — por cada categoría: cómo aplica a esta plataforma, qué se probó, cómo se probó, hallazgo, mitigación, estado.

| Categoría | Foco específico en este sistema |
|---|---|
| A01 Broken Access Control | El corazón del challenge: cross-tenant, IDOR, escalada de rol |
| A02 Cryptographic Failures | PII en reposo y en tránsito, TLS, KMS, presigned URLs |
| A03 Injection | SQL vía queries dinámicas, inyección en plantillas de notificación |
| A04 Insecure Design | Rate limiting por tenant, límites de negocio, abuso de reservas |
| A05 Security Misconfiguration | Security groups, buckets, headers, mensajes de error verbosos |
| A06 Vulnerable Components | `npm audit`, Dependabot, escaneo de imágenes en ECR |
| A07 Auth Failures | Políticas de Cognito, MFA para admins, gestión de sesión, reset de contraseña |
| A08 Integrity Failures | Firma de imágenes, integridad del audit log, verificación de webhooks de Stripe |
| A09 Logging Failures | Cobertura del audit log, detección de cross-tenant, alertas |
| A10 SSRF | Cualquier fetch de URL provista por el usuario (logos, webhooks de tenant) |

Herramientas: ZAP baseline contra staging, `npm audit`, escaneo de imágenes, `cdk-nag` o `checkov` sobre la IaC, y **los tests de aislamiento como pen-test propio** — son literalmente tu prueba de A01.

### 9.2 CI/CD con GitHub Actions
- OIDC hacia AWS (cero claves de acceso de larga vida en GitHub — si hay una `AWS_SECRET_ACCESS_KEY` en los secrets del repo, el hardening no está hecho).
- Pipeline: lint → typecheck → unit → contract → **isolation** → build de imagen → escaneo → `cdk diff` → deploy dev (automático) → deploy staging (automático en `main`) → deploy prod (con aprobación manual).
- Migraciones de DB como paso separado, con estrategia expand/contract y rollback documentado.
- Despliegue seguro: rolling con circuit breaker o blue/green, con rollback automático ante alarma.

### 9.3 Documentación final
- C4 niveles 1, 2 y 3 actualizados al estado real.
- `docs/compliance/` completo: dónde vive cada dato personal, quién accede, cómo se borra.
- README maestro con el índice de todos los artefactos.
- `docs/evidencia-criterios-aceptacion.md`: la tabla de la sección siguiente, con enlaces a evidencia.

---

## 4. Matriz de criterios de aceptación → evidencia

| Criterio | Evidencia requerida | Fase |
|---|---|---|
| Onboarding de clínica < 30 min | Log cronometrado del comando + captura de la primera cita creada | 8 |
| Dos clínicas no se ven entre sí | Reporte de la suite `tests/isolation` en verde en CI + test meta de cobertura de rutas | 3 |
| Sobrevive a caída de AZ | Reporte del game day 1 con métricas de impacto y tiempo de recuperación | 7 |
| Dashboard ejecutivo | Captura del dashboard con las 4 métricas + enlace al recurso de CloudWatch en IaC | 6 |
| Costos dentro de presupuesto | Cost model vs Cost Explorer real + Cost Anomaly Detection activo | 1, 6 |
| Documentación de compliance | `inventario-datos-personales.md` + evidencia de ejecución del job de borrado | 5 |
| Infra reproducible | Grabación o log de destroy + deploy desde cero | 2 |
| 3 RFCs + 8 ADRs + threat model + cost model | Los archivos, en estado *Aceptado* | 1 |

---

## 5. Guardrails para Claude Code (aplican a todas las fases)

Incluye este bloque en el `CLAUDE.md` del repo:

```
- NUNCA tomes decisiones de arquitectura marcadas como "PENDIENTE DE DECISIÓN HUMANA".
  Si una tarea las requiere, PARA y pregunta.
- NUNCA despliegues a AWS. Genera código, valida con synth/plan, y para. El deploy lo ejecuta
  el humano.
- NUNCA ejecutes migraciones contra bases de datos remotas.
- NUNCA hardcodees credenciales, ARNs de cuentas reales, ni endpoints de producción.
- NUNCA aceptes tenant_id desde un header, query param o body del cliente. Solo desde el JWT
  verificado.
- Si modificas spec.md o cualquier RFC/ADR ya aprobado, mantén el changelog del documento y
  no cambies la sección Decisión.
- Si un cambio debilita el aislamiento entre tenants o el audit log, PARA y explica el
  tradeoff antes de implementarlo.
- Si no puedes verificar un precio de AWS o un límite de servicio, escribe "NO VERIFICADO"
  en lugar de estimarlo de memoria.
- Documentación, comentarios y commits en español. Código en inglés. Conventional Commits.
- Un commit por unidad lógica. No commits de 40 archivos.
```

---

## 6. Riesgos del challenge

| Riesgo | Mitigación |
|---|---|
| Sobre-ingeniería: multi-región y silos antes de tener 30 clínicas reales | Pool-first, con la ruta a silo documentada pero no implementada |
| El cost model se vuelve un ejercicio de ficción | Cada número con fuente y fecha; validar contra Cost Explorer real en la Fase 6 |
| Factura de AWS inesperada durante el desarrollo | Budget con alerta desde el día 1 de la Fase 2; `cdk destroy` de dev al terminar cada sesión; cuidado con NAT Gateway y RDS Multi-AZ encendidos 24/7 |
| Compliance como documento decorativo | Todo requisito de la Fase 5 debe tener un test o un job que lo demuestre |
| Fase 1 eterna (parálisis por análisis) | Timebox: 3 RFCs y 12 ADRs en un plazo fijo. Un ADR con estado *Propuesto* y fecha de revisión es válido |
| Los tests de aislamiento se quedan atrás cuando se agregan endpoints | El test meta de cobertura de rutas de la Fase 3 |
| Reglamento pendiente de la LFPDPPP cambia los plazos de conservación | Retención configurable, no hardcodeada; fecha de revisión en el ADR-012 |

---

## 7. Stretch goals (solo después del Gate 9)

1. **Multi-región activo-activo** — el más caro y el que más invalida decisiones previas. Requiere ADR propio: replicación de datos, resolución de conflictos, routing con Route 53, y qué significa "activo-activo" para una DB relacional (probablemente: activo-activo en el plano de lectura, primario único de escritura).
2. **SOC 2 readiness al 80%** — checklist por criterio de Trust Services, mapeando cada control a la evidencia que ya generaste en las fases 5, 6, 7 y 9. Gran parte del trabajo ya está hecho si las fases anteriores se hicieron bien.
3. **SDK de cliente publicado** — generado desde OpenAPI, versionado, con autenticación por API key con scope de tenant, rate limits documentados y changelog.

---

## Anexo A — Plantilla de ADR

```markdown
# ADR-NNN: [Título corto de la decisión]

**Fecha:** YYYY-MM-DD
**Estado:** Propuesto | Aceptado | Rechazado | Reemplazado por ADR-XXX
**Decisor(es):** [nombres]

## Contexto
¿Qué problema estamos resolviendo? ¿Qué fuerzas están en juego? (2–4 párrafos máximo)

## Opciones consideradas
1. **Opción A** — descripción breve.
   - Pros: …
   - Contras: …
2. **Opción B** — descripción breve.
   - Pros: …
   - Contras: …
3. **Opción C** — descripción breve.

## Decisión
Elegimos la Opción X porque…

## Consecuencias
- **Positivas:** …
- **Negativas / tradeoffs:** …
- **Cosas a monitorear:** …

## Referencias
- Links a docs, papers, benchmarks que sustentan la decisión.
```

## Anexo B — Checklist de arranque

- [ ] Confirmar o corregir los supuestos S1–S7 (sección 1)
- [ ] Tomar las decisiones bloqueantes D1–D6 (sección 2)
- [ ] Cuenta AWS con MFA y budget con alerta configurado
- [ ] Repo de infra creado, `CLAUDE.md` con los guardrails de la sección 5
- [ ] Ejecutar el prompt de la Fase 0
