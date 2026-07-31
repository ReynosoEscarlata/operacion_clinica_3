-- Fase 6 (ADR-017), dashboard ejecutivo: GET /v1/platform-users/active
-- necesita un conteo de usuarios activos de TODOS los tenants -- RLS
-- bloquea exactamente eso para una query ORM normal, así que, igual que
-- list_users_before_credential_retention_cutoff, se necesita una función
-- SECURITY DEFINER dedicada. Regla no negociable (RFC-004, plano de
-- plataforma): solo agregados por rol, jamás una fila con el email/nombre
-- de un usuario.
CREATE OR REPLACE FUNCTION platform_active_user_counts()
RETURNS TABLE (role text, active_count bigint)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT role::text, count(*)::bigint FROM "User" WHERE active = true GROUP BY role;
$$;

GRANT EXECUTE ON FUNCTION platform_active_user_counts() TO app_role;
