-- Fase 3a (ADR-005/ADR-006, RFC-003-tenancy.md): tenant_id + RLS.
-- Ver docs/runbooks/migracion-tenant-id.md.

-- Paso 1: columnas nullable.
ALTER TABLE "Patient" ADD COLUMN "tenantId" UUID;
ALTER TABLE "Appointment" ADD COLUMN "tenantId" UUID;
ALTER TABLE "AppointmentEvent" ADD COLUMN "tenantId" UUID;
ALTER TABLE "OutboxEvent" ADD COLUMN "tenantId" UUID;
ALTER TABLE "DeadLetterEntry" ADD COLUMN "tenantId" UUID;

-- Paso 2: backfill al tenant semilla de desarrollo (sin datos de producción
-- reales, confirmado en Fase 0). AppointmentEvent hereda el tenantId de su
-- Appointment (no del semilla directo) para no depender de que coincidan si
-- alguna vez difieren.
UPDATE "Patient" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Appointment" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "AppointmentEvent" ae SET "tenantId" = a."tenantId"
  FROM "Appointment" a WHERE a."id" = ae."appointmentId" AND ae."tenantId" IS NULL;
UPDATE "OutboxEvent" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "DeadLetterEntry" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;

-- Paso 3: NOT NULL en todas (Appointments no tiene el caso de roles de
-- plataforma sin tenant que sí existe en Auth).
ALTER TABLE "Patient" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Appointment" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "AppointmentEvent" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "OutboxEvent" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "DeadLetterEntry" ALTER COLUMN "tenantId" SET NOT NULL;

-- Paso 4: Patient.email deja de ser único globalmente -- pasa a único por
-- tenant (decidido con Ricardo: un paciente es un registro por clínica).
DROP INDEX IF EXISTS "Patient_email_key";
CREATE UNIQUE INDEX "Patient_tenantId_email_key" ON "Patient"("tenantId", "email");

-- Índices compuestos con tenantId primero (reemplazan los anteriores).
CREATE INDEX "Patient_tenantId_idx" ON "Patient"("tenantId");
DROP INDEX IF EXISTS "Appointment_status_idx";
DROP INDEX IF EXISTS "Appointment_dateTime_idx";
DROP INDEX IF EXISTS "Appointment_doctorId_dateTime_idx";
CREATE INDEX "Appointment_tenantId_status_idx" ON "Appointment"("tenantId", "status");
CREATE INDEX "Appointment_tenantId_dateTime_idx" ON "Appointment"("tenantId", "dateTime");
CREATE INDEX "Appointment_tenantId_doctorId_dateTime_idx" ON "Appointment"("tenantId", "doctorId", "dateTime");
DROP INDEX IF EXISTS "AppointmentEvent_appointmentId_idx";
CREATE INDEX "AppointmentEvent_tenantId_appointmentId_idx" ON "AppointmentEvent"("tenantId", "appointmentId");
CREATE INDEX "OutboxEvent_tenantId_idx" ON "OutboxEvent"("tenantId");
DROP INDEX IF EXISTS "DeadLetterEntry_eventType_idx";
CREATE INDEX "DeadLetterEntry_tenantId_eventType_idx" ON "DeadLetterEntry"("tenantId", "eventType");

-- Paso 5: rol de aplicación sin BYPASSRLS (mismo patrón que Auth/Doctors).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD 'app_role_dev_password' NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE appointments_db TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;

-- Paso 6: RLS. A diferencia de Doctors, aquí TODO es privado -- Patient y
-- Appointment son exactamente los datos sensibles que este challenge existe
-- para aislar (no hay política pública de lectura como en el directorio de
-- doctores).
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Patient"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Appointment"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "AppointmentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AppointmentEvent"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "DeadLetterEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeadLetterEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DeadLetterEntry"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

-- Paso 7: funciones SECURITY DEFINER para resolver el tenant de un recurso a
-- partir SOLO de su id -- necesario para las rutas públicas por posesión de
-- UUID (RFC-001 del Challenge 4: el paciente no tiene cuenta, "quien tenga
-- el UUID entra"): GET/PATCH /v1/appointments/:id, GET /v1/patients/:id.
-- Devuelven únicamente el tenantId, nunca la fila completa -- exactamente
-- el mismo patrón y la misma justificación que
-- find_user_for_login/find_refresh_token_for_refresh en Auth. También se
-- usan para resolver el tenantId de un DeadLetterEntry a partir del
-- appointmentId embebido en el payload del evento fallido (el envelope de
-- Redis Streams todavía no lleva tenant_id, eso es Fase 3b).
CREATE OR REPLACE FUNCTION resolve_tenant_for_appointment(p_id uuid)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT "tenantId" FROM "Appointment" WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION resolve_tenant_for_appointment(uuid) TO app_role;

CREATE OR REPLACE FUNCTION resolve_tenant_for_patient(p_id uuid)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT "tenantId" FROM "Patient" WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION resolve_tenant_for_patient(uuid) TO app_role;

-- Excepción adicional, de la misma familia: el job de no-show (cron) es una
-- operación de sistema que necesariamente escanea TODOS los tenants para
-- encontrar candidatos (citas REMINDED vencidas) -- análogo en espíritu a
-- un futuro job de purga de retención (ADR-016). Devuelve solo id+tenantId,
-- nunca la fila completa; el caller resuelve cada candidato dentro de su
-- propio contexto de tenant antes de tocar cualquier otro dato.
CREATE OR REPLACE FUNCTION list_reminded_appointments_before(p_cutoff timestamptz)
RETURNS TABLE (id uuid, "tenantId" uuid)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId" FROM "Appointment" WHERE status = 'REMINDED' AND "dateTime" < p_cutoff;
$$;

GRANT EXECUTE ON FUNCTION list_reminded_appointments_before(timestamptz) TO app_role;
