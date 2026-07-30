-- Fix (Fase 3a): el relay del Outbox (src/lib/outbox-relay.ts) quedaba roto
-- en silencio por FORCE ROW LEVEL SECURITY -- corre sin ningún
-- app.current_tenant seteado (es un job de sistema, no una request de un
-- tenant particular), así que la política tenant_isolation de OutboxEvent
-- bloqueaba SIEMPRE su lectura directa. Mismo bug encontrado y corregido al
-- construir el relay equivalente en Payments (ver ese commit) -- se aplica
-- aquí la misma solución retroactivamente.
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
