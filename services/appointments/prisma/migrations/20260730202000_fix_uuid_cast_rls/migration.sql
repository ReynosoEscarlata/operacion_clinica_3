-- Fix (Fase 3a): TODA política que comparaba "tenantId" contra
-- current_setting(...)::uuid revienta con "invalid input syntax for type
-- uuid" en vez de simplemente denegar, si `current_setting` devuelve una
-- cadena vacía en vez de NULL -- lo que se confirmó que SÍ ocurre en la
-- práctica con una conexión reciclada del pool de Prisma sin set_config
-- previo en esta transacción (reproducido en un test de aislamiento real
-- en Doctors, no solo en teoría). Se reescriben todas las políticas de este
-- servicio comparando como TEXT, que nunca revienta con un cast inválido.
DROP POLICY tenant_isolation ON "Patient";
CREATE POLICY tenant_isolation ON "Patient"
  USING ("tenantId"::text = current_setting('app.current_tenant', true));

DROP POLICY tenant_isolation ON "Appointment";
CREATE POLICY tenant_isolation ON "Appointment"
  USING ("tenantId"::text = current_setting('app.current_tenant', true));

DROP POLICY tenant_isolation ON "AppointmentEvent";
CREATE POLICY tenant_isolation ON "AppointmentEvent"
  USING ("tenantId"::text = current_setting('app.current_tenant', true));

DROP POLICY tenant_isolation ON "OutboxEvent";
CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING ("tenantId"::text = current_setting('app.current_tenant', true));

DROP POLICY tenant_isolation ON "DeadLetterEntry";
CREATE POLICY tenant_isolation ON "DeadLetterEntry"
  USING ("tenantId"::text = current_setting('app.current_tenant', true));
