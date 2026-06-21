import type { Appointment } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { processNoShowJob } from '../../src/queues/workers/noshow.worker.js';
import type { AppointmentRepository } from '../../src/modules/appointments/appointments.repository.js';
import type { AppointmentStateMachine } from '../../src/modules/appointments/state-machine.js';

const buildLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('processNoShowJob', () => {
  it('marca como NO_SHOW las citas REMINDED vencidas hace más de 1 hora', async () => {
    const overdue = { id: 'apt-1' } as Appointment;
    const transition = vi.fn().mockResolvedValue({});
    const repository = {
      list: vi.fn().mockResolvedValue({ items: [overdue], nextCursor: null }),
      findStatusById: vi.fn().mockResolvedValue('REMINDED'),
    } as unknown as AppointmentRepository;
    const stateMachine = { transition } as unknown as AppointmentStateMachine;

    await processNoShowJob(
      { executedAt: new Date().toISOString() },
      { appointmentRepository: repository, stateMachine, logger: buildLogger() as never },
    );

    expect(transition).toHaveBeenCalledWith('apt-1', 'NO_SHOW', { trigger: 'noshow-cron' });
  });

  it('es idempotente: ignora una cita que ya no está en REMINDED al verificar de nuevo', async () => {
    const stale = { id: 'apt-2' } as Appointment;
    const transition = vi.fn();
    const repository = {
      list: vi.fn().mockResolvedValue({ items: [stale], nextCursor: null }),
      findStatusById: vi.fn().mockResolvedValue('CANCELLED'),
    } as unknown as AppointmentRepository;
    const stateMachine = { transition } as unknown as AppointmentStateMachine;

    await processNoShowJob(
      { executedAt: new Date().toISOString() },
      { appointmentRepository: repository, stateMachine, logger: buildLogger() as never },
    );

    expect(transition).not.toHaveBeenCalled();
  });

  it('no hace nada si no hay citas vencidas', async () => {
    const logger = buildLogger();
    const repository = {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      findStatusById: vi.fn(),
    } as unknown as AppointmentRepository;
    const stateMachine = { transition: vi.fn() } as unknown as AppointmentStateMachine;

    await processNoShowJob(
      { executedAt: new Date().toISOString() },
      { appointmentRepository: repository, stateMachine, logger: logger as never },
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'No hay citas para marcar como no-show',
    );
  });
});
