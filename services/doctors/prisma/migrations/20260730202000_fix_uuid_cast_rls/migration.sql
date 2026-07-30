-- Fix (Fase 3a): TODA política que comparaba "tenantId" contra
-- current_setting(...)::uuid revienta con "invalid input syntax for type
-- uuid" en vez de simplemente denegar, si `current_setting` devuelve una
-- cadena vacía en vez de NULL -- lo que se confirmó que SÍ ocurre en la
-- práctica con una conexión reciclada del pool de Prisma sin set_config
-- previo en esta transacción (reproducido en un test de aislamiento real,
-- no solo en teoría). Se reescriben todas las políticas de este servicio
-- comparando como TEXT, que nunca revienta con un cast inválido.
DROP POLICY tenant_write ON "Doctor";
DROP POLICY tenant_update ON "Doctor";
DROP POLICY tenant_delete ON "Doctor";
CREATE POLICY tenant_write ON "Doctor" FOR INSERT WITH CHECK ("tenantId"::text = current_setting('app.current_tenant', true));
CREATE POLICY tenant_update ON "Doctor" FOR UPDATE
  USING ("tenantId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant', true));
CREATE POLICY tenant_delete ON "Doctor" FOR DELETE USING ("tenantId"::text = current_setting('app.current_tenant', true));

DROP POLICY tenant_write ON "Availability";
DROP POLICY tenant_update ON "Availability";
DROP POLICY tenant_delete ON "Availability";
CREATE POLICY tenant_write ON "Availability" FOR INSERT WITH CHECK ("tenantId"::text = current_setting('app.current_tenant', true));
CREATE POLICY tenant_update ON "Availability" FOR UPDATE
  USING ("tenantId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant', true));
CREATE POLICY tenant_delete ON "Availability" FOR DELETE USING ("tenantId"::text = current_setting('app.current_tenant', true));

DROP POLICY tenant_isolation ON "OutboxEvent";
CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING ("tenantId"::text = current_setting('app.current_tenant', true));
