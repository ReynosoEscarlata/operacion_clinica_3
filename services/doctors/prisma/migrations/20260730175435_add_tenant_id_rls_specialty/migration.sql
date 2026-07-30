-- Fase 3a (ADR-005/ADR-006, RFC-003-tenancy.md): tenant_id + RLS + catálogo
-- global de especialidades médicas. Ver docs/runbooks/migracion-tenant-id.md.

-- Paso 0: catálogo cross-tenant (RFC-003, decidido 2026-07-29). Sin
-- tenantId a propósito -- compartido por todas las clínicas.
CREATE TABLE "MedicalSpecialty" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  CONSTRAINT "MedicalSpecialty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MedicalSpecialty_name_key" ON "MedicalSpecialty"("name");

INSERT INTO "MedicalSpecialty" ("id", "name") VALUES
  (gen_random_uuid(), 'Medicina General'),
  (gen_random_uuid(), 'Pediatría'),
  (gen_random_uuid(), 'Ginecología'),
  (gen_random_uuid(), 'Cardiología'),
  (gen_random_uuid(), 'Dermatología'),
  (gen_random_uuid(), 'Psiquiatría'),
  (gen_random_uuid(), 'Oncología'),
  (gen_random_uuid(), 'Infectología'),
  (gen_random_uuid(), 'Endocrinología'),
  (gen_random_uuid(), 'Traumatología');
-- Nota de compliance (threat model, amenaza #15): Psiquiatría, Oncología e
-- Infectología entran en la banda de severidad alta -- una cita con un
-- doctor de una de estas especialidades revela una condición de salud
-- sensible por combinación. Ver docs/security/threat-model.md.

-- Paso 1: columnas nullable.
ALTER TABLE "Doctor" ADD COLUMN "tenantId" UUID;
ALTER TABLE "Doctor" ADD COLUMN "specialtyId" UUID;
ALTER TABLE "Availability" ADD COLUMN "tenantId" UUID;
ALTER TABLE "OutboxEvent" ADD COLUMN "tenantId" UUID;

-- Paso 2: backfill. tenantId al tenant semilla de desarrollo (sin datos de
-- producción reales); specialtyId resuelto por nombre desde el texto libre
-- que ya existía en Doctor.specialty (columna a eliminar en el paso 3).
UPDATE "Doctor" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;
UPDATE "Doctor" d SET "specialtyId" = ms."id"
  FROM "MedicalSpecialty" ms WHERE ms."name" = d."specialty" AND d."specialtyId" IS NULL;
-- Cualquier Doctor con una especialidad de texto libre que no calce con el
-- catálogo (no debería pasar hoy, sin datos reales) cae a "Medicina General"
-- en vez de fallar la migración -- ver pregunta abierta al final.
UPDATE "Doctor" SET "specialtyId" = (SELECT "id" FROM "MedicalSpecialty" WHERE "name" = 'Medicina General')
  WHERE "specialtyId" IS NULL;

UPDATE "Availability" a SET "tenantId" = d."tenantId"
  FROM "Doctor" d WHERE d."id" = a."doctorId" AND a."tenantId" IS NULL;

-- Paso 3: se elimina la columna de texto libre, ya reemplazada por la FK.
ALTER TABLE "Doctor" DROP COLUMN "specialty";

-- Paso 4: NOT NULL donde aplica (todo -- a diferencia de Auth, Doctors no
-- tiene el caso de roles de plataforma sin tenant).
ALTER TABLE "Doctor" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Doctor" ALTER COLUMN "specialtyId" SET NOT NULL;
ALTER TABLE "Availability" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_specialtyId_fkey"
  FOREIGN KEY ("specialtyId") REFERENCES "MedicalSpecialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índices compuestos con tenantId primero.
CREATE INDEX "Doctor_tenantId_idx" ON "Doctor"("tenantId");
DROP INDEX IF EXISTS "Availability_doctorId_idx";
CREATE INDEX "Availability_tenantId_doctorId_idx" ON "Availability"("tenantId", "doctorId");
CREATE INDEX "OutboxEvent_tenantId_idx" ON "OutboxEvent"("tenantId");

-- Paso 5: rol de aplicación sin BYPASSRLS (mismo patrón que Auth).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD 'app_role_dev_password' NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE doctors_db TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;

-- Paso 6: RLS. Doctor y Availability tienen politica ASIMETRICA a proposito
-- (confirmado con Ricardo, Fase 3a): lectura publica (el directorio de
-- doctores y sus horarios es como una guia telefonica -- un paciente sin
-- cuenta necesita poder verlo para elegir con quien reservar, antes de que
-- exista cualquier contexto de tenant), escritura estrictamente scoped al
-- tenant del actor autenticado. MedicalSpecialty no lleva tenantId ni RLS
-- -- es un catalogo compartido, no hay nada que aislar.
ALTER TABLE "Doctor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Doctor" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "Doctor" FOR SELECT USING (true);
CREATE POLICY tenant_write ON "Doctor" FOR INSERT WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_update ON "Doctor" FOR UPDATE
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_delete ON "Doctor" FOR DELETE USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "Availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Availability" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "Availability" FOR SELECT USING (true);
CREATE POLICY tenant_write ON "Availability" FOR INSERT WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_update ON "Availability" FOR UPDATE
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_delete ON "Availability" FOR DELETE USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);
