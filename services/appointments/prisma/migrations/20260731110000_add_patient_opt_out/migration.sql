-- Fase 5, derecho ARCO de oposición (RFC/plan maestro): bandera simple en
-- Patient. false por default -- ningún paciente existente queda opt-out
-- retroactivamente.
ALTER TABLE "Patient" ADD COLUMN "optOut" BOOLEAN NOT NULL DEFAULT false;
