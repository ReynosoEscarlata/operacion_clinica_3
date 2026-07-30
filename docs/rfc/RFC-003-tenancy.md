# RFC-003: Modelo de tenancy

**Fase:** 1 del `claude/PLAN-challenge-5-plataforma-para-todos.md`
**Estado:** Aceptado (2026-07-29)
**Relacionado:** `docs/baseline-challenge-4.md` (inventario de línea base), `docs/backlog-deuda.md`
(ítems 1-4, todos BLOQUEA-MULTITENANCY), ADR-005, ADR-006.

---

## Contexto

El sistema hoy (post-Challenge 4) es de **una sola clínica de punta a punta** — confirmado en la
Fase 0: ninguna tabla de ningún servicio (`auth`, `appointments`, `doctors`, `payments`,
`notifications`, ni el monolito legado) tiene columna de tenant/clínica. Convertirlo en SaaS B2B
para múltiples clínicas requiere decidir **dónde vive el límite de aislamiento entre clínicas**
antes de tocar una sola línea de código de la Fase 3.

Esta decisión es la más cara de revertir de todo el challenge: migrar datos de "shared DB +
`tenant_id`" a "DB-per-tenant" con 30 clínicas en producción es un proyecto de migración con
downtime potencial, no un refactor de una tarde.

## Requisitos

**Funcionales:**
- Una clínica nunca debe poder leer, modificar ni enumerar datos de otra clínica, en ningún nivel
  (HTTP, DB, cache, eventos).
- Onboarding de una clínica nueva en menos de 30 minutos (criterio de aceptación del challenge,
  Fase 8) — esto descarta cualquier modelo que requiera aprovisionar infraestructura nueva por
  clínica como paso obligatorio del onboarding estándar.
- Debe existir una ruta para dar a una clínica grande un nivel de aislamiento superior (silo) sin
  reescribir la arquitectura.

**De compliance:**
- Datos de salud son sensibles bajo LFPDPPP (ver `docs/security/threat-model.md`). El borrado
  verificable de todos los datos de una clínica (derecho de cancelación/portabilidad) debe ser
  técnicamente posible y demostrable.
- Debe soportar residencia de datos en México (pendiente de ADR-010, D4).

**De costo:**
- Presupuesto objetivo: ~$150-300 USD/mes a 10 clínicas (rango austero confirmado por Ricardo en
  Fase 0), techo a evaluar a 100 clínicas. Cualquier modelo cuyo costo marginal por clínica sea
  significativamente mayor que el de una fila en una tabla compartida debe justificarse.

## Opciones

### Opción A — Shared DB + `tenant_id` + Row Level Security

Un único Postgres por servicio (los mismos 5 que ya existen), con columna `tenant_id` en toda
tabla que hoy tiene datos de una clínica, y Row Level Security de Postgres como enforcement de
motor (no solo de aplicación).

- **Pros:**
  - Costo marginal por clínica es prácticamente cero (una fila más, no una instancia más).
  - Onboarding es una operación transaccional (INSERT de fila de tenant + seed), compatible con el
    criterio de <30 min de la Fase 8.
  - RLS da una defensa a nivel de motor: incluso si el código de aplicación olvida el filtro
    `WHERE tenant_id = ?`, Postgres lo aplica igual (con `FORCE ROW LEVEL SECURITY` y un rol de
    aplicación sin `BYPASSRLS`).
  - Backups, monitoreo y capacidad se gestionan una sola vez por servicio, no por clínica.
- **Contras:**
  - El "blast radius" de un bug de query mal filtrado, aunque mitigado por RLS, sigue siendo la
    misma base de datos física — un bug en el motor mismo o un rol mal configurado afecta a todas
    las clínicas a la vez.
  - Backup/restore es atómico por servicio completo, no por clínica individual — restaurar los
    datos de una sola clínica desde un backup requiere extraer filas, no adjuntar un archivo.
  - Migraciones de esquema (`prisma migrate`) siguen siendo una sola operación para todas las
    clínicas — una migración con bug afecta a todas simultáneamente.

### Opción B — Schema-per-tenant

Un schema de Postgres por clínica dentro de la misma instancia física, por servicio.

- **Pros:**
  - Mejor aislamiento lógico que RLS: un `search_path` mal configurado es un error más visible
    que una política RLS ausente, y algunas herramientas de auditoría lo detectan más fácilmente.
  - Backup por schema es técnicamente posible (`pg_dump --schema=`), acercándose a granularidad
    por cliente sin una instancia completa.
- **Contras:**
  - Postgres tiene un límite práctico de miles de schemas por instancia antes de que el catálogo
    (`pg_catalog`) se vuelva un cuello de botella — a 1000 clínicas esto es real, no teórico.
  - Las migraciones de Prisma no tienen soporte nativo multi-schema con un solo comando; requeriría
    tooling propio para aplicar la misma migración N veces (una por schema) de forma transaccional
    y con rollback coordinado.
  - El pool de conexiones de cada servicio tendría que cambiar de schema por request
    (`SET search_path`) con el mismo riesgo de fuga por conexión reutilizada que RLS resuelve con
    `SET LOCAL` transaccional — no es automáticamente más seguro si se implementa mal.

### Opción C — DB-per-tenant

Una instancia (o al menos una base de datos lógica) de Postgres completa por clínica, por
servicio.

- **Pros:**
  - Aislamiento máximo: un bug de query nunca puede cruzar el límite de conexión de red hacia otra
    base de datos.
  - Backup, restore y borrado completo de una clínica son operaciones naturales y auditable de
    forma trivial (documentar: "se borró la instancia X").
  - Ruta de escalado horizontal sin límites de Postgres por catálogo compartido.
- **Contras:**
  - Costo marginal por clínica deja de ser cercano a cero: cada clínica nueva implica al menos una
    instancia RDS más (o una conexión gestionada más), lo que rompe el presupuesto austero
    confirmado (~$150-300/mes a 10 clínicas) mucho antes de llegar a 100.
  - Onboarding en <30 min requeriría aprovisionar infraestructura nueva (RDS toma minutos en
    crearse, no importa cuán automatizado esté) — factible pero mucho más frágil que un INSERT.
  - Migraciones de esquema deben aplicarse N veces, una por instancia, con mayor superficie de
    fallo parcial (¿qué pasa si la migración corre bien en 8 de 10 instancias?).

### Opción D — Híbrido pool + silo desde el diseño

Variante de la Opción A donde, desde el día 1, el esquema de datos y el código soportan
explícitamente dos tiers: la mayoría de clínicas en el pool compartido (Opción A), y clínicas
grandes con contrato especial en una instancia/schema dedicado (silo), sin que esto sea una
migración de emergencia sino un camino ya construido.

- **Pros:** combina el costo bajo de A para la mayoría de clínicas con la posibilidad de vender
  aislamiento dedicado como tier premium, sin tener que inventar la ruta de escape bajo presión.
- **Contras:** duplica la superficie de código desde el inicio (el repositorio base debe soportar
  resolver la conexión correcta según si el tenant es pool o silo) — más complejidad de
  implementación temprana a cambio de una capacidad que hoy (0 clínicas reales) nadie ha pedido
  todavía.

## Comparativa

| Eje | A: Shared DB + tenant_id + RLS | B: Schema-per-tenant | C: DB-per-tenant | D: Híbrido pool+silo |
|---|---|---|---|---|
| Costo a 10 / 100 / 1000 clínicas | [ver cost-model] — marginal ≈0 por clínica | [ver cost-model] — marginal bajo hasta el límite de catálogo | [ver cost-model] — marginal = 1 instancia RDS por clínica, escala linealmente | [ver cost-model] — como A para el pool, como C para los silos (pocos) |
| Aislamiento (blast radius de un bug de query) | Medio — mitigado por RLS a nivel de motor, pero misma instancia física | Medio-alto — límite lógico más fuerte, pero depende de disciplina de `search_path` | Alto — límite de red/instancia | Medio para el pool, alto para silos |
| Riesgo de fuga cruzada de datos | Bajo si RLS está bien configurado (`FORCE ROW LEVEL SECURITY`, rol sin `BYPASSRLS`); medio si se confía solo en el ORM | Bajo-medio, mismo riesgo de "olvidar cambiar de schema" que RLS de olvidar el filtro | Muy bajo — el error tendría que ser de red/config de infraestructura | Igual que A/C según el tier |
| Tiempo de onboarding | Minutos (INSERT + seed) — compatible con <30 min | Minutos-decenas de minutos (crear schema + aplicar N migraciones) | Decenas de minutos (crear instancia, aplicar migraciones, configurar red) — factible pero más frágil | Minutos para pool; como C para silo |
| Complejidad de migraciones de esquema | Baja — una sola operación por servicio | Alta — debe aplicarse por schema, con límites prácticos de Postgres en número de esquemas | Alta — debe aplicarse N veces, con manejo de fallo parcial | Baja para pool, alta para silos (pocos, aceptable) |
| Granularidad de backup/restore por cliente | Baja — requiere extraer filas de un backup completo | Media — `pg_dump --schema=` es viable | Alta — backup/restore nativo por instancia | Baja para pool, alta para silo |
| Noisy neighbor / QoS | Riesgo real — una clínica con mucho tráfico comparte CPU/IO con las demás | Igual que A (misma instancia física) | Ninguno — aislamiento de recursos por instancia | Riesgo en pool, ninguno en silo |
| Límites duros de Postgres (conexiones, nº de esquemas/tablas) | Ninguno relevante hasta cifras muy altas de filas | Real: miles de schemas degradan `pg_catalog` | Ninguno (cada instancia es independiente) | Ninguno relevante para la mayoría (pool), sin límite en silos (pocos) |
| Compliance: borrado de datos de un tenant | Requiere borrado en cascada verificable por `tenant_id` en cada tabla (job de purga, Fase 5) | `DROP SCHEMA` es una operación natural y auditable | `DROP DATABASE`/terminar instancia es la operación más simple de auditar | Como A para pool, como C para silo |
| Portabilidad: exportar/salir un cliente | Requiere un export dirigido por `tenant_id` (query explícita) | `pg_dump --schema=` exporta al cliente completo | Backup de la instancia completa | Como A/C según tier |
| Esfuerzo de implementación en el código actual | Medio — ver diff conceptual abajo | Alto — requiere tooling de migración multi-schema que hoy no existe (Prisma no lo soporta nativo) | Medio-alto — requiere plano de control de aprovisionamiento de instancias (converge con la Fase 8 de todas formas) | Alto — suma el esfuerzo de A más el enrutamiento de conexión por tier |

## Diff conceptual sobre el código actual, por opción

**Opción A (shared DB + RLS):**
- Los 6 `schema.prisma` (monolito, auth, appointments, doctors, payments, notifications) ganan
  `tenant_id UUID NOT NULL` en toda tabla listada como PII/tenant-scoped en
  `docs/baseline-challenge-4.md` sección 2, con índices compuestos `(tenant_id, ...)`.
  `User`/`RefreshToken` en Auth también (un usuario Admin/Staff pertenece a una clínica, salvo los
  roles de plataforma — ver RFC-004).
- Nuevo `TenantContext` (`AsyncLocalStorage`) en cada servicio, análogo al `request-context.ts` que
  ya existe para `requestId` — mismo patrón, otro campo.
- Nuevo middleware `tenant-context.ts` en cada servicio (junto a `middleware/request-id.ts`) que
  extrae `tenant_id` del claim JWT verificado.
- Repositorio base nuevo del que heredan `appointments.repository.ts`, `patients.repository.ts`,
  `doctors.repository.ts`, `users.repository.ts`, `webhook-events.repository.ts`, etc. — cada uno
  ejecuta `SET LOCAL app.current_tenant` antes de cualquier query, dentro de una transacción.
- Los envelopes de eventos (`AppointmentCreated`, `PaymentSucceeded`, etc., ver sección 4 del
  baseline) ganan `tenant_id` obligatorio; `event-consumer.ts` en Appointments/Notifications valida
  su presencia antes de procesar.
- `DoctorsClient`/`PaymentsClient` (`services/appointments/src/clients/`) deben propagar
  `tenant_id` en las llamadas HTTP internas (hoy no propagan ni siquiera `requestId`, ver backlog
  ítem 4).

**Opción B (schema-per-tenant):** todo lo anterior de A, más: reemplazar `prisma migrate deploy`
por un script propio que itere sobre schemas (no existe hoy ninguna pieza de este tooling);
cambiar el pool de conexiones de Prisma para resolver `search_path` por tenant en vez de
`tenant_id` como columna.

**Opción C (DB-per-tenant):** elimina la necesidad de `tenant_id` como columna, pero requiere
construir el plano de control de aprovisionamiento de instancias RDS (converge con
`tenant-provisioning` de la Fase 8) mucho antes de esa fase, y un mecanismo de *service discovery*
para que cada servicio sepa a qué instancia conectarse según el tenant del JWT.

**Opción D:** el diff de A, más una capa de resolución de conexión (`ConnectionResolver`) que
decide, por tenant, si usar el pool compartido o una conexión dedicada — no existe ningún análogo
hoy en el código.

## Decisión

Elegimos la **Opción A: shared DB + `tenant_id` + Row Level Security**, ratificada por Ricardo el
2026-07-29 (ver ADR-005). La Opción D (híbrido pool+silo desde el diseño) se evaluó y se descarta
por ahora — con 0 clínicas reales hoy, construir la capacidad de silo desde el día 1 es esfuerzo
sin demanda demostrada; la ruta de escape pool→silo documentada abajo cubre ese caso si aparece.
El enforcement de 3 capas (ADR-006) se ratifica también sin cambios sobre lo ya redactado.

## Propagación del contexto de tenant

- El `tenant_id` **nunca** se acepta desde un header, query param o body del cliente (guardrail no
  negociable, ver `CLAUDE.md`).
- Origen único: claim `tenant_id` dentro del JWT firmado por Auth (RS256, ya existente), inyectado
  al token en el momento de login/refresh — requiere que `User` (Auth) tenga su propio
  `tenant_id` para poder incluirlo al firmar.
- Viaja por HTTP en el JWT ya presente en `Authorization: Bearer`, verificado por el gateway
  (`verify-jwt.ts`, ya extrae `role` a un header interno `x-internal-user-role`; se agregaría
  `x-internal-tenant-id` con el mismo patrón de límite de confianza de red interna).
- Viaja en el envelope de los eventos de dominio (Redis Streams) como campo obligatorio del
  payload, poblado por el productor del evento a partir de su propio `TenantContext` en el momento
  de escribir al Outbox (misma transacción que el resto del evento).
- Llega al pool de conexiones vía `SET LOCAL app.current_tenant = '<uuid>'` ejecutado al inicio de
  cada transacción del repositorio base — nunca `SET` a nivel de sesión, porque con connection
  pooling (PgBouncer o el pool interno de Prisma) una conexión reutilizada con el tenant equivocado
  es la fuga clásica de este patrón.

## Estrategia de enforcement (defensa en profundidad, 3 capas)

1. **Postgres (RLS):** política por tabla que compara `tenant_id` contra
   `current_setting('app.current_tenant')`, con `FORCE ROW LEVEL SECURITY` y un rol de aplicación
   sin `BYPASSRLS`. Esta es la capa que sobrevive incluso si el ORM tiene un bug.
2. **Middleware de aplicación:** el `TenantContext` puebla el `AsyncLocalStorage`; cualquier
   request sin `tenant_id` en el JWT falla con 401 antes de llegar a cualquier lógica de negocio.
3. **Repositorio base:** ningún acceso a datos pasa fuera de la clase base que aplica
   `SET LOCAL`. Si algún acceso no puede pasar por ahí (ej. un script administrativo), se
   documenta explícitamente como excepción justificada (ver Fase 3 del plan maestro).

La premisa de diseño es que **el ORM va a fallar algún día** (un desarrollador olvida el `WHERE`,
una migración automática genera una query distinta) — por eso RLS no es opcional ni redundante.

## Ruta de escape: pool → silo sin downtime

Aunque la Opción A no incluya silos desde el día 1 (a diferencia de la Opción D), la ruta debe
quedar escrita:
1. Aprovisionar instancia/schema dedicado para el tenant candidato.
2. Doble escritura temporal (o CDC) desde el pool hacia el silo mientras se sincroniza el backlog
   histórico.
3. Corte de tráfico de lectura hacia el silo, verificación de paridad de datos.
4. Corte de escritura, actualización del *service discovery*/resolución de conexión para ese
   tenant.
5. Retención del tenant en el pool solo como respaldo de rollback por un período definido, luego
   purga verificable.

Tener esta ruta escrita, aunque nunca se ejecute, es lo que distingue un diseño de una apuesta.

## Datos cross-tenant por diseño

Explícitamente **no** llevan `tenant_id` y son compartidos entre todas las clínicas:
- **Catálogo de especialidades médicas** — decidido (2026-07-29): se normaliza `Doctor.specialty`
  de texto libre a un catálogo global cross-tenant en la Fase 3 (`MedicalSpecialty`, sin
  `tenant_id`, referenciado por FK desde `Doctor`). Cada clínica selecciona de la lista, no escribe
  texto libre. Esto habilita reportes agregados de plataforma por especialidad y hace explícito,
  en el propio modelo de datos, cuáles especialidades entran en la banda de severidad máxima del
  threat model (amenaza #15) sin depender de comparar strings libres.
- Plantillas de notificación por defecto (Notifications) — una clínica puede personalizarlas,
  pero el default es global.
- Plano de control de tenants (`tenant-provisioning`, Fase 8) — por definición vive fuera del
  contexto de un tenant específico.
- Métricas agregadas de plataforma (dashboards ejecutivos de Fase 6, agregados across-tenant para
  el equipo de la plataforma, nunca expuestos a una clínica individual).

## Usuarios de plataforma en el modelo de datos

Decidido (2026-07-29): `User.tenant_id` en Auth es **nullable**; `NULL` identifica exclusivamente
a los roles de plataforma (`platform_admin`/`platform_support`, RFC-004) — no es un tenant más,
es la ausencia explícita de tenant. Se prefirió esto sobre una tabla `PlatformUser` separada para
no duplicar el modelo de autenticación (login, refresh tokens, JWKS) que ya funciona en Auth.

**Consecuencia directa para RLS (ADR-006):** la política de Postgres sobre `User` no puede ser un
simple `tenant_id = current_setting('app.current_tenant')` — debe permitir explícitamente que un
actor con rol de plataforma (verificado por el claim de rol del JWT, no por la sola ausencia de
tenant) opere sin ese filtro, mientras que un `tenant_id` `NULL` nunca debe ser alcanzable por un
actor de tenant normal. Esto es una excepción justificada y documentada a la regla general de RLS,
no un bypass silencioso — debe implementarse como una segunda política explícita en la tabla
`User` (`USING (tenant_id IS NULL AND current_setting('app.actor_role') IN ('platform_admin',
'platform_support'))` o equivalente), no como `BYPASSRLS` en el rol de aplicación.

## Riesgos

- Confiar solo en el ORM/aplicación sin RLS es el riesgo más alto identificado — mitigado
  explícitamente por la capa 1 de enforcement.
- El gap ya detectado en Fase 0 (Auth sin `outbox-relay.ts`, backlog ítem 6) debe resolverse antes
  o durante la Fase 3, porque `UserCreated` con `tenant_id` es el evento que permitiría a otros
  servicios (si algún día lo necesitan) conocer el tenant de un usuario sin consultar la BD de Auth.
- `DoctorsClient`/`PaymentsClient` sin propagación de contexto (backlog ítem 4) es un riesgo de
  fuga real si no se corrige en el mismo alcance que el resto de la Fase 3.

## Preguntas abiertas para el humano

Todas las preguntas abiertas originales de este RFC se resolvieron el 2026-07-29 (ver "Decisión",
"Datos cross-tenant por diseño" y "Usuarios de plataforma en el modelo de datos" arriba). Sin
preguntas pendientes para pasar a la Fase 3, salvo las que surjan al implementar la política RLS
de excepción para `User.tenant_id IS NULL`.
