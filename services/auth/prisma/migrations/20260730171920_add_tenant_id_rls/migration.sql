-- Fase 3a (ADR-005/ADR-006, RFC-003-tenancy.md): tenant_id + Row Level Security.
-- Ver docs/runbooks/migracion-tenant-id.md para el plan de ejecucion completo
-- (por que esta sesion no necesita ventana de mantenimiento ni doble escritura).

-- Paso 1: columnas nullable (ninguna aplicacion depende de ellas todavia).
ALTER TABLE "User" ADD COLUMN "tenantId" UUID;
ALTER TABLE "RefreshToken" ADD COLUMN "tenantId" UUID;
ALTER TABLE "OutboxEvent" ADD COLUMN "tenantId" UUID;

-- Paso 2: backfill al tenant semilla de desarrollo (no hay datos de
-- produccion reales, confirmado en docs/baseline-challenge-4.md).
UPDATE "RefreshToken" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;

-- Paso 3: NOT NULL donde aplica. User queda NULLABLE a proposito (RFC-003:
-- NULL = platform_admin/platform_support, roles de plataforma que esta fase
-- no construye pero para los que el esquema debe estar listo).
ALTER TABLE "RefreshToken" ALTER COLUMN "tenantId" SET NOT NULL;

-- Indices compuestos con tenantId primero.
DROP INDEX IF EXISTS "RefreshToken_userId_idx";
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
CREATE INDEX "RefreshToken_tenantId_userId_idx" ON "RefreshToken"("tenantId", "userId");
CREATE INDEX "OutboxEvent_tenantId_idx" ON "OutboxEvent"("tenantId");

-- Paso 4: rol de aplicacion sin BYPASSRLS (ADR-006). Password de desarrollo
-- fija (Docker Compose local/CI) -- en AWS real vive en Secrets Manager,
-- gap declarado en el plan de Fase 3a (pendiente de reconciliar con
-- infra/lib/stacks/database-stack.ts).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD 'app_role_dev_password' NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE auth_db TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;

-- Paso 5: Row Level Security. FORCE hace que ni siquiera el owner de la tabla
-- (el rol de migracion) se salte la politica sin BYPASSRLS explicito -- la
-- premisa de ADR-006 es que el ORM va a fallar algun dia, esta es la capa
-- que sobrevive a ese dia.
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RefreshToken"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING (
    "tenantId" = current_setting('app.current_tenant', true)::uuid
    OR ("tenantId" IS NULL AND current_setting('app.actor_role', true) IN ('platform_admin', 'platform_support'))
  );

-- User: politica de dos ramas -- fila de tenant normal visible solo a su
-- propio tenant; fila de plataforma (tenantId NULL) visible solo cuando el
-- actor mismo es un rol de plataforma (RFC-003). Ningun actor de tenant
-- puede ver filas de plataforma, y un actor de plataforma sin
-- current_setting('app.actor_role') seteado tampoco ve nada -- fail closed.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING (
    "tenantId" = current_setting('app.current_tenant', true)::uuid
    OR ("tenantId" IS NULL AND current_setting('app.actor_role', true) IN ('platform_admin', 'platform_support'))
  );

-- Paso 6: funciones SECURITY DEFINER para el problema de "huevo y gallina"
-- del login/refresh -- para autenticar a alguien todavia NO se conoce su
-- tenant (el cliente manda email+password o un refresh token, no un
-- tenant_id), asi que la busqueda inicial es necesariamente cross-tenant.
-- Estas funciones son la UNICA excepcion deliberada a RLS en este servicio:
-- se ejecutan con los privilegios de quien las crea (el rol de migracion,
-- que en Docker local es superusuario y por lo tanto ya bypassea RLS
-- siempre) y devuelven exclusivamente las columnas minimas necesarias para
-- decidir autenticacion, nunca la fila completa ni datos de otros usuarios.
-- Gap declarado para AWS: en RDS, el usuario master no necesariamente
-- bypassea RLS con FORCE activo -- verificar al reconciliar con
-- infra/lib/stacks/database-stack.ts antes de un deploy real.
CREATE OR REPLACE FUNCTION find_user_for_login(p_email text)
RETURNS TABLE (id uuid, "tenantId" uuid, "passwordHash" text, active boolean, role text)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId", "passwordHash", active, role::text
  FROM "User"
  WHERE email = p_email;
$$;

GRANT EXECUTE ON FUNCTION find_user_for_login(text) TO app_role;

CREATE OR REPLACE FUNCTION find_user_by_id_for_refresh(p_id uuid)
RETURNS TABLE (id uuid, "tenantId" uuid, active boolean, role text)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId", active, role::text
  FROM "User"
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION find_user_by_id_for_refresh(uuid) TO app_role;

CREATE OR REPLACE FUNCTION find_refresh_token_for_refresh(p_token_hash text)
RETURNS TABLE (id uuid, "tenantId" uuid, "userId" uuid, "expiresAt" timestamp, "revokedAt" timestamp)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId", "userId", "expiresAt", "revokedAt"
  FROM "RefreshToken"
  WHERE "tokenHash" = p_token_hash;
$$;

GRANT EXECUTE ON FUNCTION find_refresh_token_for_refresh(text) TO app_role;
