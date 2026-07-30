# Runbook — Migración de `tenant_id` (Fase 3a)

**Escrito antes de la migración**, tal como exige el prompt de la Fase 3 del plan maestro.
Referencia: ADR-005 (shared DB + `tenant_id` + RLS), ADR-006 (defensa en profundidad),
RFC-003-tenancy.md.

## Alcance

Agregar `tenantId` a toda tabla de datos de tenant en 4 de los 5 servicios (`auth`, `appointments`,
`doctors`, `payments`), habilitar Row Level Security, y separar el rol de aplicación (sin
`BYPASSRLS`) del rol de migración (owner). `notifications` queda fuera del alcance de esta
ejecución — ver sección "Notifications: diferido a Fase 3b" más abajo.

## Situación real de este proyecto (confirmada en Fase 0)

**No existe producción real todavía** — el sistema corre solo en Docker Compose local, con datos
de prueba. Esto determina la estrategia de ESTA ejecución:

- **No se requiere ventana de mantenimiento.**
- **No se requiere doble escritura.**
- El backfill es: un único tenant semilla de desarrollo, todas las filas existentes en las BDs
  de dev/test se le asignan antes de poner la columna `NOT NULL`.

**Tenant semilla de desarrollo** (fijo, documentado aquí para que cualquiera que corra la
migración en su máquina obtenga el mismo resultado):
```
00000000-0000-0000-0000-000000000001
```

## Estrategia general (para una migración futura con datos reales — no aplica hoy, documentada igual)

Si este proyecto llegara a tener clínicas reales en producción antes de ejecutar esta migración,
la estrategia cambiaría radicalmente — se documenta aquí porque el plan maestro lo exige
explícitamente, aunque no se ejecute en esta sesión:

1. **Expand**: agregar `tenantId` como columna **nullable** en todas las tablas, sin `NOT NULL`
   todavía. Desplegar. La aplicación sigue funcionando (ninguna columna nueva es obligatoria).
2. **Backfill dirigido**: en este proyecto solo existe una clínica real operando en el momento de
   migrar (es SaaS naciente) — el backfill sería asignar el `tenantId` de esa única clínica a
   todas las filas existentes, en lotes (`UPDATE ... WHERE tenantId IS NULL LIMIT N`, repetido)
   para no bloquear la tabla con una transacción gigante.
3. **Doble escritura temporal**: durante el backfill, el código de aplicación debe escribir
   `tenantId` en cada INSERT nuevo (esto ya se despliega desde el paso 1, vía el repositorio base),
   así que no hace falta una fase de "doble escritura" separada — a diferencia de una migración de
   modelo de datos que cambia la forma de una columna existente, aquí es una columna nueva que la
   app ya sabe poblar desde el día del deploy del paso 1.
4. **Contract**: una vez que el backfill llega a 0 filas con `tenantId IS NULL`, aplicar
   `ALTER COLUMN tenantId SET NOT NULL` — operación rápida en Postgres si no hay filas nulas
   (valida sin reescribir la tabla completa en versiones recientes de Postgres, pero igual
   recomienda verificarse contra el tamaño real de la tabla antes de ejecutar en horario pico).
5. Solo después de 4: habilitar RLS + `FORCE ROW LEVEL SECURITY` + políticas. Antes de este paso,
   ninguna fila puede depender de RLS para su aislamiento (fallaría con `tenantId NULL`).
6. **Ventana de mantenimiento**: no necesaria para los pasos 1-4 (son compatibles con tráfico
   vivo). Sí recomendable para el paso 5 en el primer despliegue a un entorno con tráfico real,
   como precaución (una política mal escrita podría devolver 0 filas a todos los tenants
   simultáneamente) — mitigado por probar exhaustivamente en `staging` primero.

## Ejecución real de esta sesión (dev/test, sin datos reales)

Dado que no hay datos reales, los pasos 1-4 de la estrategia general se colapsan en una sola
migración de Prisma por servicio, sin ventana de mantenimiento:

1. `ALTER TABLE "X" ADD COLUMN "tenantId" UUID;` (nullable).
2. `UPDATE "X" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;`
3. `ALTER TABLE "X" ALTER COLUMN "tenantId" SET NOT NULL;` (excepto `User` en Auth, que queda
   nullable — ver RFC-003).
4. Crear rol `app_role` (`LOGIN`, sin `BYPASSRLS`), otorgar privilegios sobre las tablas.
5. `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY; ALTER TABLE "X" FORCE ROW LEVEL SECURITY;`
6. `CREATE POLICY tenant_isolation ON "X" USING ("tenantId" = current_setting('app.current_tenant')::uuid);`

Todo esto vive en un único archivo de migración de Prisma por servicio (SQL crudo dentro de
`prisma/migrations/<timestamp>_add_tenant_id_rls/migration.sql`), reversible con el `DROP` inverso
documentado al final de cada archivo (no ejecutado automáticamente — Prisma no genera `down`
migrations automáticas; el rollback es manual si hiciera falta).

## Rol de aplicación vs. rol de migración

- **Rol de migración** (`DATABASE_URL`, el que ya existe hoy): owner de la base, ejecuta
  `prisma migrate deploy`, tiene privilegio para crear roles/políticas/tablas.
- **Rol de aplicación** (`DATABASE_URL_APP`, nuevo): usado por el proceso Node en runtime y por los
  tests. Sin `BYPASSRLS`. Password fija de desarrollo en `.env.example` (no es un secreto real,
  vive solo en Docker Compose local) — en AWS real, este rol necesita su propio secreto en Secrets
  Manager, gap ya declarado en el plan de Fase 3a como pendiente de reconciliar con
  `infra/lib/stacks/database-stack.ts`.

## Verificación post-migración

- `SELECT * FROM pg_policies WHERE tablename = 'Appointment';` — confirma que la política existe.
- Conectado como `app_role`: `SET app.current_tenant = '<uuid-tenant-A>'; SELECT count(*) FROM "Appointment";`
  debe devolver solo las filas de A, nunca las de B, incluso sin `WHERE`.
- Conectado como `app_role` SIN haber hecho `SET app.current_tenant`:
  `SELECT * FROM "Appointment";` debe devolver **cero filas** (no un error, no todas las filas) —
  este es el comportamiento esperado de `current_setting(..., true)` combinado con
  `FORCE ROW LEVEL SECURITY` cuando no hay tenant seteado.

## Rollback

Si la migración de un servicio falla a mitad de camino:
1. `npx prisma migrate resolve --rolled-back <nombre-migracion>` en ese servicio.
2. Revisar el `migration.sql` generado — el paso más frágil es el `UPDATE` de backfill si la tabla
   tiene muchas filas (no aplica hoy, con datos de prueba).
3. Nunca reintentar un `ALTER COLUMN ... SET NOT NULL` sin antes confirmar `SELECT count(*) FROM x WHERE "tenantId" IS NULL` = 0.

## Notifications: diferido a Fase 3b

A diferencia de `auth`, `appointments`, `doctors` y `payments`, **`notifications` no recibió
`tenantId`/RLS en esta ejecución (Fase 3a)**. Razón: todas sus tablas (`AppointmentSnapshot`,
`PatientSnapshot`, `DoctorSnapshot`, `NotificationLog`, `DeadLetterEntry`) se pueblan
exclusivamente a partir de los payloads que llegan por Redis Streams (`AppointmentCreated`,
`AppointmentStatusChanged`, `PatientUpdated`, `DoctorCreated/Updated`, `PaymentFailed`) — y esos
payloads **hoy no llevan `tenant_id`**. Agregar la columna ahora habría significado, o (a) dejarla
NULL en el 100% de las filas hasta que la mensajería lo propague (RLS que no aísla nada, puro
andamiaje), o (b) adelantar la propagación de `tenant_id` en los eventos — que es exactamente el
alcance de ADR-014/Fase 3b (migración completa a SQS/SNS), no de esta sesión. Confirmado con
Ricardo: se difiere `notifications` completo a Fase 3b, junto con el resto de la propagación de
tenant en mensajería.

**Pendiente para cuando se ejecute Fase 3b:**
1. Los publishers (`AppointmentCreated`/`AppointmentStatusChanged` en Appointments,
   `DoctorCreated`/`DoctorUpdated` en Doctors, `PaymentFailed` en Payments) deben incluir
   `tenantId` en el payload del evento.
2. `notifications` agrega `tenantId` (NOT NULL, sin caso de fila sin tenant — a diferencia de
   Payments, aquí no hay ningún evento legítimamente "sin tenant") + RLS + `tenant-context.ts` +
   `tenant-scoped.ts`, mismo molde que los demás servicios.
3. El consumer (`server.ts`/`event-handlers.ts`) entra en `runWithTenant(payload.tenantId, ...)`
   antes de invocar cada handler — mismo patrón que ya usa `appointments/src/server.ts` para
   `PaymentSucceeded`/`PaymentFailed`.
4. `dead-letter.repository.ts` sigue el patrón de `appointments/src/lib/dead-letter.repository.ts`
   (tenantId explícito en `record()`, ambiental en `list`/`findById`/`remove`).

## Decisiones (confirmadas con Ricardo, 2026-07-30)

1. El tenant semilla (`00000000-0000-0000-0000-000000000001`, nombre "Clínica Demo") es
   **independiente** de los seeds del monolito (`src/prisma/seed.ts`,
   `seed-demo-appointments.ts`) — el monolito es un sistema legado separado, con su propia BD, sin
   relación con la BD de los 5 servicios nuevos.
2. Password del `app_role` en Docker Compose local: placeholder de desarrollo
   `app_role_dev_password`, consistente con cómo ya se manejan las passwords de Postgres en
   `docker-compose.yml` (ej. `POSTGRES_PASSWORD: appointments`). Nunca se usa en AWS real.
