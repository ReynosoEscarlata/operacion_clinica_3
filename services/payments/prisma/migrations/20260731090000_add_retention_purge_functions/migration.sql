-- Fase 5 (ADR-016): funciones de sistema para el job de purga de
-- retención -- mismo patrón que list_reminded_appointments_before en
-- Appointments (SECURITY DEFINER, cross-tenant por naturaleza, devuelve
-- solo id+tenantId). WebhookEvent.tenantId es nullable (Stripe manda
-- eventos sin metadata resoluble a veces) -- se incluye igual, el caller
-- ya sabe manejar tenantId null (mismo patrón que processEvent).
CREATE OR REPLACE FUNCTION list_webhook_events_before_retention_cutoff(p_cutoff timestamptz)
RETURNS TABLE (id uuid, "tenantId" uuid)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId" FROM "WebhookEvent" WHERE "createdAt" < p_cutoff;
$$;

GRANT EXECUTE ON FUNCTION list_webhook_events_before_retention_cutoff(timestamptz) TO app_role;

CREATE OR REPLACE FUNCTION list_outbox_events_before_retention_cutoff(p_cutoff timestamptz)
RETURNS TABLE (id uuid, "tenantId" uuid)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId" FROM "OutboxEvent" WHERE "createdAt" < p_cutoff;
$$;

GRANT EXECUTE ON FUNCTION list_outbox_events_before_retention_cutoff(timestamptz) TO app_role;
