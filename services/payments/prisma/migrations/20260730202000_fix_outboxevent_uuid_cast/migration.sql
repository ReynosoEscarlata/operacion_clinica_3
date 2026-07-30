-- Fix (Fase 3a): OutboxEvent quedó con la misma comparación `::uuid` que ya
-- se corrigió en WebhookEvent -- confirmado con un test de aislamiento real
-- en Doctors que la cadena vacía (no NULL) que puede devolver
-- current_setting en una conexión reciclada del pool de Prisma SÍ revienta
-- un cast a uuid, incluso sin ninguna rama OR. Se compara como texto, que
-- nunca revienta.
DROP POLICY tenant_isolation ON "OutboxEvent";
CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING ("tenantId"::text = current_setting('app.current_tenant', true));
