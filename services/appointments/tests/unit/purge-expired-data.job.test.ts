import { describe, expect, it } from 'vitest';

import { purgeExpiredData } from '../../src/jobs/purge-expired-data.job.js';
import { logger } from '../../src/lib/logger.js';
import type { AppointmentRepository, ReminderCandidate } from '../../src/modules/appointments/appointments.repository.js';
import type { OrphanedPatientCandidate, PatientRepository } from '../../src/modules/patients/patients.repository.js';

const TENANT_A = 'a0000000-a000-a000-a000-a00000000001';

const buildFakeAppointmentRepository = (
  candidates: ReminderCandidate[],
): AppointmentRepository & { deletedIds: string[] } => {
  const deletedIds: string[] = [];
  return {
    deletedIds,
    createPending: async () => {
      throw new Error('no usado en este test');
    },
    findById: async () => null,
    findStatusById: async () => null,
    findByPaymentIntentId: async () => null,
    list: async () => ({ items: [], nextCursor: null }),
    deleteHard: async (id: string) => {
      deletedIds.push(id);
    },
    addEvent: async () => {},
    getDashboardStats: async () => {
      throw new Error('no usado en este test');
    },
    listRecentEvents: async () => [],
    listRemindedBefore: async () => [],
    listBeforeRetentionCutoff: async () => candidates,
  } as unknown as AppointmentRepository & { deletedIds: string[] };
};

const buildFakePatientRepository = (
  candidates: OrphanedPatientCandidate[],
): PatientRepository & { deletedIds: string[] } => {
  const deletedIds: string[] = [];
  return {
    deletedIds,
    create: async () => {
      throw new Error('no usado en este test');
    },
    findByEmail: async () => null,
    findById: async () => null,
    update: async () => null,
    list: async () => [],
    deleteHard: async (id: string) => {
      deletedIds.push(id);
    },
    listOrphaned: async () => candidates,
    listAuditHistory: async () => [],
    recordArcoAccess: async () => {},
    requestCancellation: async () => true,
    setOptOut: async () => null,
  };
};

describe('purgeExpiredData (Fase 5, ADR-016)', () => {
  it('dry-run reporta candidatos sin borrar nada', async () => {
    const appointmentRepository = buildFakeAppointmentRepository([{ id: 'apt-1', tenantId: TENANT_A }]);
    const patientRepository = buildFakePatientRepository([{ id: 'pat-1', tenantId: TENANT_A }]);

    const report = await purgeExpiredData({ appointmentRepository, patientRepository, logger }, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.appointmentsFound).toBe(1);
    expect(report.appointmentsDeleted).toBe(0);
    expect(report.patientsFound).toBe(1);
    expect(report.patientsDeleted).toBe(0);
    expect(appointmentRepository.deletedIds).toHaveLength(0);
    expect(patientRepository.deletedIds).toHaveLength(0);
  });

  it('modo real borra las citas vencidas y los pacientes huérfanos encontrados', async () => {
    const appointmentRepository = buildFakeAppointmentRepository([
      { id: 'apt-1', tenantId: TENANT_A },
      { id: 'apt-2', tenantId: TENANT_A },
    ]);
    const patientRepository = buildFakePatientRepository([{ id: 'pat-1', tenantId: TENANT_A }]);

    const report = await purgeExpiredData({ appointmentRepository, patientRepository, logger }, { dryRun: false });

    expect(report.dryRun).toBe(false);
    expect(report.appointmentsDeleted).toBe(2);
    expect(report.patientsDeleted).toBe(1);
    expect(appointmentRepository.deletedIds).toEqual(['apt-1', 'apt-2']);
    expect(patientRepository.deletedIds).toEqual(['pat-1']);
  });

  it('sin candidatos, el reporte queda en cero sin llamar a deleteHard', async () => {
    const appointmentRepository = buildFakeAppointmentRepository([]);
    const patientRepository = buildFakePatientRepository([]);

    const report = await purgeExpiredData({ appointmentRepository, patientRepository, logger }, { dryRun: false });

    expect(report.appointmentsFound).toBe(0);
    expect(report.patientsFound).toBe(0);
    expect(appointmentRepository.deletedIds).toHaveLength(0);
    expect(patientRepository.deletedIds).toHaveLength(0);
  });

  it('un error al borrar un candidato no interrumpe el resto', async () => {
    const appointmentRepository = buildFakeAppointmentRepository([
      { id: 'apt-1', tenantId: TENANT_A },
      { id: 'apt-2', tenantId: TENANT_A },
    ]);
    appointmentRepository.deleteHard = async (id: string) => {
      if (id === 'apt-1') throw new Error('boom');
      appointmentRepository.deletedIds.push(id);
    };
    const patientRepository = buildFakePatientRepository([]);

    const report = await purgeExpiredData({ appointmentRepository, patientRepository, logger }, { dryRun: false });

    expect(report.appointmentsDeleted).toBe(1);
    expect(appointmentRepository.deletedIds).toEqual(['apt-2']);
  });

  it('usa un corte de 5 años (1825 días) hacia atrás desde `now`', async () => {
    const appointmentRepository = buildFakeAppointmentRepository([]);
    const patientRepository = buildFakePatientRepository([]);
    const now = new Date('2026-07-31T00:00:00.000Z');

    const report = await purgeExpiredData({ appointmentRepository, patientRepository, logger }, { dryRun: true, now });

    // Diferencia en días calendario, no milisegundos exactos -- setDate()
    // opera en hora local, así que un corte que cruza un cambio de horario
    // de verano puede diferir en una hora del cálculo ingenuo en UTC.
    const diffDays = (now.getTime() - report.cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(1824.9);
    expect(diffDays).toBeLessThan(1825.1);
  });
});
