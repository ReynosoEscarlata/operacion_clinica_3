-- Fase 3b (ADR-014): primer relay de Auth en su historia (cierra
-- docs/backlog-deuda.md ítem 6 -- UserCreated/UserDeactivated quedaban con
-- publishedAt: null para siempre). Mismas funciones SECURITY DEFINER que ya
-- usan Doctors/Appointments/Payments para su relay: es un job de sistema
-- (no una request de un tenant particular) leyendo bajo FORCE ROW LEVEL
-- SECURITY -- sin esto, con app_role y sin ningún app.current_tenant
-- seteado, la política tenant_isolation de OutboxEvent bloquearía SIEMPRE
-- su lectura directa.
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
