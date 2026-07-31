-- Fase 5, derecho ARCO de oposición: propagado desde Appointments vía
-- PatientUpdated. false por default -- ningún snapshot existente queda
-- opt-out retroactivamente.
ALTER TABLE "PatientSnapshot" ADD COLUMN "optOut" BOOLEAN NOT NULL DEFAULT false;
