import type { Appointment } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { processReminderJob } from '../../src/queues/workers/reminder.worker.js';
import type { AppointmentRepository } from '../../src/modules/appointments/appointments.repository.js';
import type { AppointmentStateMachine } from '../../src/modules/appointments/state-machine.js';

const buildLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() });

const buildAppointment = (overrides: Partial<Appointment> = {}): Appointment =>
  ({
    id: 'apt-1',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    dateTime: new Date(),
    durationMinutes: 30,
    amountCents: 50_000,
    status: 'PAID',
    cancellationReason: null,
    stripePaymentIntentId: 'pi_1',
    confirmedAt: null,
    paidAt: new Date(),
    remindedAt: null,
    completedAt: null,
    cancelledAt: null,
    noShowAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Appointment;

describe('processReminderJob', () => {
  it('transiciona PAID -> REMINDED sin enviar ningún email (responsabilidad de Notifications)', async () => {
    const transition = vi.fn().mockResolvedValue(buildAppointment({ status: 'REMINDED' }));
    const repository = {
      findById: vi.fn().mockResolvedValue(buildAppointment()),
    } as unknown as AppointmentRepository;
    const stateMachine = { transition } as unknown as AppointmentStateMachine;

    await processReminderJob({ appointmentId: 'apt-1' }, { appointmentRepository: repository, stateMachine, logger: buildLogger() as never });

    expect(transition).toHaveBeenCalledWith('apt-1', 'REMINDED', {
      trigger: 'reminder-job',
      eventType: 'REMINDER_SENT',
    });
  });

  it('es idempotente: ignora la cita si ya no está en PAID', async () => {
    const transition = vi.fn();
    const repository = {
      findById: vi.fn().mockResolvedValue(buildAppointment({ status: 'CANCELLED' })),
    } as unknown as AppointmentRepository;
    const stateMachine = { transition } as unknown as AppointmentStateMachine;

    await processReminderJob({ appointmentId: 'apt-1' }, { appointmentRepository: repository, stateMachine, logger: buildLogger() as never });

    expect(transition).not.toHaveBeenCalled();
  });

  it('lanza si la cita no existe (para que BullMQ reintente)', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as AppointmentRepository;
    const stateMachine = { transition: vi.fn() } as unknown as AppointmentStateMachine;

    await expect(
      processReminderJob(
        { appointmentId: 'no-existe' },
        { appointmentRepository: repository, stateMachine, logger: buildLogger() as never },
      ),
    ).rejects.toThrow('Cita no encontrada');
  });
});
