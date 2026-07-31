-- Fase 3b (ADR-014, RFC-003-tenancy.md): tenant_id + RLS, diferido desde
-- Fase 3a hasta que el envelope de eventos de dominio trajera tenantId de
-- punta a punta. Ver docs/runbooks/migracion-tenant-id.md.

-- Paso 1: columnas nullable.
ALTER TABLE "AppointmentSnapshot" ADD COLUMN "tenantId" UUID;
ALTER TABLE "PatientSnapshot" ADD COLUMN "tenantId" UUID;
ALTER TABLE "DoctorSnapshot" ADD COLUMN "tenantId" UUID;
ALTER TABLE "NotificationLog" ADD COLUMN "tenantId" UUID;
ALTER TABLE "DeadLetterEntry" ADD COLUMN "tenantId" UUID;

-- Paso 2: backfill al tenant semilla de desarrollo (sin datos de producción
-- reales -- Notifications reconstruye sus snapshots desde los eventos, así
-- que perder la fila más antigua en un ambiente real se resolvería solo en
-- el próximo evento; no aplica acá porque no hay ambiente real todavía).
UPDATE "AppointmentSnapshot" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "PatientSnapshot" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "DoctorSnapshot" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "NotificationLog" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "DeadLetterEntry" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;

-- Paso 3: NOT NULL (todo -- a diferencia de Auth, Notifications no tiene
-- roles de plataforma sin tenant).
ALTER TABLE "AppointmentSnapshot" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PatientSnapshot" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "DoctorSnapshot" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "NotificationLog" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "DeadLetterEntry" ALTER COLUMN "tenantId" SET NOT NULL;

-- Índices compuestos con tenantId primero.
CREATE INDEX "AppointmentSnapshot_tenantId_idx" ON "AppointmentSnapshot"("tenantId");
CREATE INDEX "PatientSnapshot_tenantId_idx" ON "PatientSnapshot"("tenantId");
CREATE INDEX "DoctorSnapshot_tenantId_idx" ON "DoctorSnapshot"("tenantId");
DROP INDEX IF EXISTS "NotificationLog_appointmentId_idx";
CREATE INDEX "NotificationLog_tenantId_appointmentId_idx" ON "NotificationLog"("tenantId", "appointmentId");
DROP INDEX IF EXISTS "DeadLetterEntry_eventType_idx";
CREATE INDEX "DeadLetterEntry_tenantId_eventType_idx" ON "DeadLetterEntry"("tenantId", "eventType");

-- Paso 4: rol de aplicación sin BYPASSRLS (mismo patrón que los otros 4
-- servicios).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD 'app_role_dev_password' NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE notifications_db TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;

-- Paso 5: RLS simétrica en las 5 tablas -- a diferencia de Doctors/
-- Appointments, ninguna ruta de Notifications es de lectura pública (todo
-- vive detrás de dead_letter:* del plano de plataforma, o se escribe desde
-- el consumer de eventos de dominio); no aplica ninguna política asimétrica.
ALTER TABLE "AppointmentSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AppointmentSnapshot"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "PatientSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientSnapshot"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "DoctorSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DoctorSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DoctorSnapshot"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "NotificationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationLog"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "DeadLetterEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeadLetterEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DeadLetterEntry"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);
