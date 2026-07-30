-- Fase 4 (RFC-004-rbac.md, ADR-012): 6 roles con cuenta (patient excluido,
-- RFC-001), doctorId, y RefreshToken.tenantId nullable para permitir login
-- de platform_admin/platform_support (bloqueado hasta ahora en
-- auth.service.ts -- ver ese commit).

-- Paso 1: UserRole. ALTER COLUMN ... TYPE ... USING con backfill inline --
-- no hay datos de producción reales (mismo criterio que
-- docs/runbooks/migracion-tenant-id.md), así que el mapeo se aplica en la
-- misma transacción de la migración, sin ventana de mantenimiento.
-- Mapeo: ADMIN -> CLINIC_OWNER, STAFF -> RECEPTIONIST.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'CLINIC_OWNER', 'CLINIC_ADMIN', 'DOCTOR', 'RECEPTIONIST');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING (
  CASE "role"::text
    WHEN 'ADMIN' THEN 'CLINIC_OWNER'
    WHEN 'STAFF' THEN 'RECEPTIONIST'
  END
)::"UserRole";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'RECEPTIONIST';
DROP TYPE "UserRole_old";

-- Paso 2: doctorId (referencia por id a Doctor en services/doctors, sin FK
-- real -- RFC-001). Alimenta el claim doctorId del JWT (ver
-- services/auth/src/lib/jwt.ts).
ALTER TABLE "User" ADD COLUMN "doctorId" UUID;
CREATE INDEX "User_doctorId_idx" ON "User"("doctorId");

-- Paso 3: RefreshToken.tenantId nullable + política de dos ramas, mismo
-- patrón que User/OutboxEvent (comparación por texto, no por ::uuid -- ver
-- 20260730201500_fix_null_tenant_rls_cast / 20260730202000_fix_refresh_token_uuid_cast,
-- un cast a uuid revienta la fila entera si current_setting no es un uuid
-- válido en ese momento en vez de dejar pasar la rama NULL).
ALTER TABLE "RefreshToken" ALTER COLUMN "tenantId" DROP NOT NULL;

DROP POLICY tenant_isolation ON "RefreshToken";
CREATE POLICY tenant_isolation ON "RefreshToken"
  USING (
    "tenantId"::text = current_setting('app.current_tenant', true)
    OR ("tenantId" IS NULL AND current_setting('app.actor_role', true) IN ('platform_admin', 'platform_support'))
  );

-- Paso 4: las funciones SECURITY DEFINER de login/refresh (excepción
-- deliberada a RLS, ver 20260730171920_add_tenant_id_rls) ganan doctorId --
-- lo necesita signAccessToken() para poblar el claim. Postgres no permite
-- CREATE OR REPLACE cuando cambia la lista de columnas de RETURNS TABLE, hay
-- que dropear primero.
DROP FUNCTION IF EXISTS find_user_for_login(text);
CREATE FUNCTION find_user_for_login(p_email text)
RETURNS TABLE (id uuid, "tenantId" uuid, "passwordHash" text, active boolean, role text, "doctorId" uuid)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId", "passwordHash", active, role::text, "doctorId"
  FROM "User"
  WHERE email = p_email;
$$;

GRANT EXECUTE ON FUNCTION find_user_for_login(text) TO app_role;

DROP FUNCTION IF EXISTS find_user_by_id_for_refresh(uuid);
CREATE FUNCTION find_user_by_id_for_refresh(p_id uuid)
RETURNS TABLE (id uuid, "tenantId" uuid, active boolean, role text, "doctorId" uuid)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId", active, role::text, "doctorId"
  FROM "User"
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION find_user_by_id_for_refresh(uuid) TO app_role;
