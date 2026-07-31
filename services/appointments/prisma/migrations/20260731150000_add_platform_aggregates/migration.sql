-- Fase 6 (ADR-017), dashboard ejecutivo: GET /v1/platform/dashboard necesita
-- KPIs agregados de TODOS los tenants -- RLS bloquea exactamente eso para
-- una query ORM normal (por diseño), así que, igual que
-- resolve_tenant_for_appointment/list_reminded_appointments_before, se
-- necesitan funciones SECURITY DEFINER dedicadas. Regla no negociable
-- (RFC-004, plano de plataforma): SOLO agregados + conteos, jamás una fila
-- con PII (nombre, email, motivo de cancelación) -- estas 3 funciones nunca
-- devuelven un id de paciente/cita/doctor.
CREATE OR REPLACE FUNCTION platform_status_counts()
RETURNS TABLE (status text, count bigint)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT status::text, count(*)::bigint FROM "Appointment" GROUP BY status;
$$;

GRANT EXECUTE ON FUNCTION platform_status_counts() TO app_role;

CREATE OR REPLACE FUNCTION platform_appointment_aggregates(p_start_today timestamptz, p_start_week timestamptz)
RETURNS TABLE (appointments_today bigint, appointments_this_week bigint)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT
    count(*) FILTER (WHERE "dateTime" >= p_start_today)::bigint,
    count(*) FILTER (WHERE "dateTime" >= p_start_week)::bigint
  FROM "Appointment";
$$;

GRANT EXECUTE ON FUNCTION platform_appointment_aggregates(timestamptz, timestamptz) TO app_role;

-- Mismos estados que cuentan como ingreso real en DashboardStats por-tenant
-- (appointments.repository.ts, REVENUE_STATUSES) -- PAID/REMINDED/COMPLETED.
CREATE OR REPLACE FUNCTION platform_revenue_aggregates(
  p_start_today timestamptz,
  p_start_week timestamptz,
  p_start_month timestamptz
)
RETURNS TABLE (revenue_today bigint, revenue_this_week bigint, revenue_this_month bigint)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT
    coalesce(sum("amountCents") FILTER (WHERE "dateTime" >= p_start_today), 0)::bigint,
    coalesce(sum("amountCents") FILTER (WHERE "dateTime" >= p_start_week), 0)::bigint,
    coalesce(sum("amountCents") FILTER (WHERE "dateTime" >= p_start_month), 0)::bigint
  FROM "Appointment"
  WHERE status IN ('PAID', 'REMINDED', 'COMPLETED');
$$;

GRANT EXECUTE ON FUNCTION platform_revenue_aggregates(timestamptz, timestamptz, timestamptz) TO app_role;
