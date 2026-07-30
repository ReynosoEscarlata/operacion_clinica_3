-- Fix (Fase 3a): las políticas de OutboxEvent y User comparaban el tenant
-- ambiental con `::uuid` incluso en la rama que existe justamente para
-- filas SIN tenant (tenantId IS NULL). Postgres no garantiza cortocircuito
-- en un OR fila por fila -- si `current_setting('app.current_tenant',
-- true)` no es un uuid válido en el momento de evaluar la política (ej.
-- cadena vacía en una conexión reciclada del pool sin set_config previo en
-- esta transacción), el cast revienta la fila entera con "invalid input
-- syntax for type uuid" en vez de dejar pasar la rama NULL. Bug real
-- encontrado (y con un caso reproducido) al construir el equivalente en
-- Payments -- ver ese commit. Se corrige comparando como texto, que nunca
-- revienta.
DROP POLICY tenant_isolation ON "OutboxEvent";
CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING (
    "tenantId"::text = current_setting('app.current_tenant', true)
    OR ("tenantId" IS NULL AND current_setting('app.actor_role', true) IN ('platform_admin', 'platform_support'))
  );

DROP POLICY tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User"
  USING (
    "tenantId"::text = current_setting('app.current_tenant', true)
    OR ("tenantId" IS NULL AND current_setting('app.actor_role', true) IN ('platform_admin', 'platform_support'))
  );
