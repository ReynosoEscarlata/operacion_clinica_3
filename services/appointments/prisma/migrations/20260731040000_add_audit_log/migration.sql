-- Fase 5 (ADR-013): audit log inmutable. Append-only por privilegio de
-- motor -- GRANT SELECT, INSERT seguido de un REVOKE UPDATE, DELETE
-- explícito (GRANT es aditivo: no alcanza con "solo otorgar" SELECT/INSERT
-- cuando la ALTER DEFAULT PRIVILEGES de 20260730190000_add_tenant_id_rls ya
-- le dio UPDATE/DELETE a app_role sobre toda tabla nueva -- ver el mismo
-- fix aplicado a SupportAccessGrant en services/auth).
CREATE TABLE "AuditLog" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"      UUID NOT NULL,
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

-- Mismo patrón de aislamiento que Patient/Appointment: tenantId NOT NULL,
-- una sola rama (::text, nunca ::uuid -- ver 20260730202000_fix_uuid_cast_rls).
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("tenantId"::text = current_setting('app.current_tenant', true));
