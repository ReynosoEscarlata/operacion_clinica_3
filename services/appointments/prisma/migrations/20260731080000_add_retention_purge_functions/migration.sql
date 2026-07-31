-- Fase 5 (ADR-016): función de sistema para el job de purga de retención --
-- mismo patrón que list_reminded_appointments_before (SECURITY DEFINER,
-- cross-tenant por naturaleza, devuelve solo id+tenantId). Candidatos:
-- citas en estado terminal (CANCELLED/COMPLETED/NO_SHOW) cuya última
-- actividad relevante quedó antes del corte de retención -- una cita
-- todavía activa nunca es candidata, sin importar su antigüedad.
CREATE OR REPLACE FUNCTION list_appointments_before_retention_cutoff(p_cutoff timestamptz)
RETURNS TABLE (id uuid, "tenantId" uuid)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, "tenantId" FROM "Appointment"
  WHERE status IN ('CANCELLED', 'COMPLETED', 'NO_SHOW')
    AND COALESCE("cancelledAt", "completedAt", "noShowAt") < p_cutoff;
$$;

GRANT EXECUTE ON FUNCTION list_appointments_before_retention_cutoff(timestamptz) TO app_role;

-- Candidatos a Patient huérfano: sin ninguna Appointment restante. Se
-- consulta DESPUÉS de purgar las Appointment vencidas (mismo job, mismo
-- corte) -- un paciente con al menos una cita dentro de retención nunca
-- aparece acá, sin importar cuántas citas viejas ya se hayan purgado.
CREATE OR REPLACE FUNCTION list_orphaned_patients()
RETURNS TABLE (id uuid, "tenantId" uuid)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT p.id, p."tenantId" FROM "Patient" p
  WHERE NOT EXISTS (SELECT 1 FROM "Appointment" a WHERE a."patientId" = p.id);
$$;

GRANT EXECUTE ON FUNCTION list_orphaned_patients() TO app_role;
