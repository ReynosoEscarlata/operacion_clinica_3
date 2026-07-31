-- Fase 5 (ADR-013): audit log inmutable. Append-only por privilegio de
-- motor -- app_role gana SELECT/INSERT y el UPDATE/DELETE que le llegaría
-- por la ALTER DEFAULT PRIVILEGES de 20260730171920_add_tenant_id_rls se
-- revoca explícitamente a continuación (ver el fix de la migración
-- anterior: GRANT es aditivo, no alcanza con "solo otorgar" SELECT/INSERT).
CREATE TABLE "AuditLog" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"      UUID,
  "actorId"       TEXT,
  "actorRole"     TEXT,
  "action"        TEXT NOT NULL,
  "resourceType"  TEXT NOT NULL,
  "resourceId"    TEXT,
  "ip"            TEXT,
  "userAgent"     TEXT,
  "correlationId" TEXT,
  "result"        TEXT NOT NULL,
  "justification" TEXT,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

GRANT SELECT, INSERT ON "AuditLog" TO app_role;
REVOKE UPDATE, DELETE ON "AuditLog" FROM app_role;

-- Misma política de dos ramas que User/RefreshToken/OutboxEvent: un actor
-- de tenant solo ve sus propias filas; un actor de plataforma
-- (platform_admin/platform_support) ve todo, incluidas las filas con
-- tenantId NULL (acciones de plataforma, ej. login de un platform_admin).
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING (
    "tenantId"::text = current_setting('app.current_tenant', true)
    OR current_setting('app.actor_role', true) IN ('platform_admin', 'platform_support')
  );
