import type { AppointmentRepository } from '../modules/appointments/appointments.repository.js';
import type { PatientRepository } from '../modules/patients/patients.repository.js';
import type { Logger } from '../lib/logger.js';
import { PATIENT_DATA_RETENTION_DAYS } from '../lib/retention-policy.js';
import { runWithTenant } from '../lib/tenant-context.js';

export interface PurgeReport {
  cutoff: Date;
  dryRun: boolean;
  appointmentsFound: number;
  appointmentsDeleted: number;
  patientsFound: number;
  patientsDeleted: number;
}

const computeCutoff = (now: Date): Date => {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - PATIENT_DATA_RETENTION_DAYS);
  return cutoff;
};

export interface PurgeExpiredDataDeps {
  appointmentRepository: AppointmentRepository;
  patientRepository: PatientRepository;
  logger: Logger;
}

// Fase 5 (ADR-016): job de purga de retención. Orden deliberado -- primero
// las Appointment vencidas (Patient tiene onDelete: Restrict desde
// Appointment, borrar Patient primero rompería la FK), después los Patient
// que quedaron sin ninguna Appointment restante. Ambos comparten el mismo
// corte de 5 años anclado a "última actividad de la cita" (ADR-016), así
// que un Patient con al menos una cita todavía dentro de retención nunca
// aparece como huérfano, sin importar cuántas citas viejas ya se hayan
// purgado en esta misma corrida.
export const purgeExpiredData = async (
  deps: PurgeExpiredDataDeps,
  options: { dryRun: boolean; now?: Date },
): Promise<PurgeReport> => {
  const cutoff = computeCutoff(options.now ?? new Date());
  const { appointmentRepository, patientRepository, logger } = deps;

  const appointmentCandidates = await appointmentRepository.listBeforeRetentionCutoff(cutoff);
  let appointmentsDeleted = 0;

  if (!options.dryRun) {
    for (const candidate of appointmentCandidates) {
      try {
        await runWithTenant(candidate.tenantId, () => appointmentRepository.deleteHard(candidate.id));
        appointmentsDeleted += 1;
      } catch (error) {
        logger.error({ err: error, appointmentId: candidate.id }, 'Error al purgar cita vencida');
      }
    }
  }

  // Los candidatos a Patient huérfano se resuelven DESPUÉS de borrar las
  // citas de arriba -- en dry-run se calculan igual, sobre el estado actual
  // (sin las citas que se habrían borrado), así que el conteo de dry-run es
  // un piso conservador, no la cifra exacta que dejaría una corrida real.
  const patientCandidates = await patientRepository.listOrphaned();
  let patientsDeleted = 0;

  if (!options.dryRun) {
    for (const candidate of patientCandidates) {
      try {
        await runWithTenant(candidate.tenantId, () => patientRepository.deleteHard(candidate.id));
        patientsDeleted += 1;
      } catch (error) {
        logger.error({ err: error, patientId: candidate.id }, 'Error al purgar paciente huérfano');
      }
    }
  }

  const report: PurgeReport = {
    cutoff,
    dryRun: options.dryRun,
    appointmentsFound: appointmentCandidates.length,
    appointmentsDeleted,
    patientsFound: patientCandidates.length,
    patientsDeleted,
  };

  logger.info(report, options.dryRun ? 'Purga de retención (dry-run)' : 'Purga de retención completada');

  return report;
};
