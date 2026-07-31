-- Fase 4 (RFC-004-rbac.md, "Escalada de privilegios"): tabla de grants
-- temporales de acceso de soporte de plataforma. A diferencia de
-- User/RefreshToken/OutboxEvent, esta tabla NUNCA tiene filas de tenant
-- "propias" que aislar por app.current_tenant -- toda fila pertenece
-- conceptualmente al plano de plataforma (quién de plataforma accedió a
-- qué tenant), así que la política solo exige que el actor SEA de
-- plataforma, sin comparar tenantId en absoluto.
CREATE TABLE "SupportAccessGrant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actorId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportAccessGrant_actorId_tenantId_idx" ON "SupportAccessGrant"("actorId", "tenantId");
CREATE INDEX "SupportAccessGrant_expiresAt_idx" ON "SupportAccessGrant"("expiresAt");

-- app_role gana SELECT/INSERT únicamente -- sin UPDATE/DELETE, append-only
-- por privilegio de motor, no solo por convención de la app (ver comentario
-- en schema.prisma sobre inmutabilidad real diferida a Fase 5).
GRANT SELECT, INSERT ON "SupportAccessGrant" TO app_role;

ALTER TABLE "SupportAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportAccessGrant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupportAccessGrant"
  USING (current_setting('app.actor_role', true) IN ('platform_admin', 'platform_support'));
