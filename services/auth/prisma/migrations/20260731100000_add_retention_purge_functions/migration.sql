-- Fase 5 (ADR-016): función de sistema para el job de purga de retención de
-- credenciales -- mismo patrón que list_reminded_appointments_before en
-- Appointments (SECURITY DEFINER, cross-tenant por naturaleza, devuelve
-- solo id+tenantId). Candidatos: cuentas dadas de baja (active = false)
-- hace más de ACCOUNT_CREDENTIALS_RETENTION_DAYS -- updatedAt sirve de
-- proxy porque deactivate() es la única operación que toca User después de
-- darlo de baja, y el propio job vuelve a tocar updatedAt al purgar
-- passwordHash, así que una cuenta ya purgada no vuelve a aparecer como
-- candidata hasta que algo más la modifique (idempotencia sin columna
-- nueva).
CREATE OR REPLACE FUNCTION list_users_before_credential_retention_cutoff(p_cutoff timestamptz)
RETURNS TABLE (id uuid, "tenantId" uuid)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId" FROM "User" WHERE active = false AND "updatedAt" < p_cutoff;
$$;

GRANT EXECUTE ON FUNCTION list_users_before_credential_retention_cutoff(timestamptz) TO app_role;
