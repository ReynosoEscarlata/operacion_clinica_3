-- Fase 3a (ADR-005/ADR-006, RFC-003-tenancy.md): tenant_id + RLS.
-- Ver docs/runbooks/migracion-tenant-id.md.
--
-- Payments no tiene tabla propia de citas (RFC-001, cero estado
-- compartido): el tenant se resuelve desde el metadata del PaymentIntent de
-- Stripe (poblado por Appointments al crearlo, ver
-- payments.service.ts/webhook.service.ts), nunca desde una consulta a otra
-- BD.

-- Paso 1: columnas. WebhookEvent NULLABLE (idempotencia cross-tenant de
-- TODOS los eventos que Stripe manda a este único endpoint compartido --
-- no todos traen un tenant resoluble, ver nota en schema.prisma).
-- OutboxEvent NOT NULL (solo se escribe cuando ya se resolvió el tenant).
ALTER TABLE "WebhookEvent" ADD COLUMN "tenantId" UUID;
ALTER TABLE "OutboxEvent" ADD COLUMN "tenantId" UUID;

-- Paso 2: backfill al tenant semilla de desarrollo (sin datos de producción
-- reales, confirmado en Fase 0).
UPDATE "OutboxEvent" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "tenantId" IS NULL;

-- Paso 3: NOT NULL solo en OutboxEvent.
ALTER TABLE "OutboxEvent" ALTER COLUMN "tenantId" SET NOT NULL;

-- Índices.
CREATE INDEX "WebhookEvent_tenantId_idx" ON "WebhookEvent"("tenantId");
DROP INDEX IF EXISTS "OutboxEvent_publishedAt_idx";
CREATE INDEX "OutboxEvent_tenantId_publishedAt_idx" ON "OutboxEvent"("tenantId", "publishedAt");

-- Paso 4: rol de aplicación sin BYPASSRLS (mismo patrón que Auth/Doctors/Appointments).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD 'app_role_dev_password' NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE payments_db TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;

-- Paso 5: RLS. WebhookEvent acepta tenantId NULL (evento sin tenant
-- resoluble) ademas de su propio tenant -- no es el mismo caso que
-- "usuario de plataforma" de Auth (no hay concepto de actor/rol aqui, este
-- servicio nunca expone WebhookEvent por HTTP a ningun tenant), por eso no
-- hace falta gatear el branch NULL con ningun rol.
--
-- Comparacion como TEXT (no `::uuid`) a proposito: Postgres NO garantiza
-- evaluacion de cortocircuito en un OR fila por fila -- si el lado
-- `current_setting(...)::uuid` se evalua igual (aunque "tenantId" IS NULL
-- ya haria el OR verdadero) y el valor de la sesion no es un uuid valido
-- (ej. cadena vacia, que puede devolver current_setting en una conexion
-- reciclada del pool sin set_config previo en esta transaccion), el cast
-- revienta la fila entera con "invalid input syntax for type uuid" en vez
-- de dejar pasar el branch NULL. Comparando como texto el cast nunca
-- revienta, solo da false.
ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookEvent"
  USING ("tenantId" IS NULL OR "tenantId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING ("tenantId" = current_setting('app.current_tenant', true)::uuid);

-- Paso 6: funciones SECURITY DEFINER para el relay del Outbox (Fase 3,
-- src/lib/outbox-relay.ts) -- drena eventos de TODOS los tenants hacia
-- Redis Streams por diseño (es un job de sistema, no una request de un
-- tenant particular; el propio evento ya lleva su tenantId en la columna,
-- que viaja downstream dentro del payload una vez se complete ADR-014/Fase
-- 3b). Sin esto, con FORCE ROW LEVEL SECURITY activo y ningun
-- app.current_tenant seteado en la conexion del relay, la política
-- tenant_isolation bloquearía SIEMPRE cualquier lectura -- el relay dejaría
-- de publicar eventos en silencio. Devuelven la fila completa de
-- OutboxEvent (a diferencia de find_user_for_login/list_reminded_*, que
-- devuelven solo columnas mínimas) porque el propio relay es lo que ya
-- confiamos en que reenvía el evento completo a Redis.
CREATE OR REPLACE FUNCTION list_unpublished_outbox_events(p_limit integer)
RETURNS SETOF "OutboxEvent"
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT * FROM "OutboxEvent" WHERE "publishedAt" IS NULL ORDER BY "createdAt" ASC LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION mark_outbox_event_published(p_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
AS $$
  UPDATE "OutboxEvent" SET "publishedAt" = now() WHERE id = p_id;
$$;
