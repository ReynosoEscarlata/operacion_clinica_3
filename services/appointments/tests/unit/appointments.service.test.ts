import type { Appointment } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { buildAppointmentService } from '../../src/modules/appointments/appointments.service.js';
import type { AppointmentRepository } from '../../src/modules/appointments/appointments.repository.js';
import type { AppointmentStateMachine } from '../../src/modules/appointments/state-machine.js';
import type { DoctorsClient } from '../../src/clients/doctors-client.js';
import type { PaymentsClient } from '../../src/clients/payments-client.js';
import type { PatientRepository } from '../../src/modules/patients/patients.repository.js';
import { logger } from '../../src/lib/logger.js';

const buildAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appt-1',
  patientId: 'patient-1',
  doctorId: 'doctor-1',
  dateTime: new Date(Date.now() + 86_400_000),
  durationMinutes: 30,
  amountCents: 50_000,
  status: 'CONFIRMED',
  cancellationReason: null,
  stripePaymentIntentId: 'pi_1',
  confirmedAt: new Date(),
  paidAt: null,
  remindedAt: null,
  completedAt: null,
  cancelledAt: null,
  noShowAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('AppointmentService.confirmPayment', () => {
  it('transiciona CONFIRMED -> PAID a través de la state machine', async () => {
    const paid = buildAppointment({ status: 'PAID', paidAt: new Date() });
    const stateMachine: AppointmentStateMachine = {
      canTransition: vi.fn().mockReturnValue(true),
      transition: vi.fn().mockResolvedValue(paid),
    };

    const enqueueReminder = vi.fn().mockResolvedValue(undefined);
    const service = buildAppointmentService({
      repository: {} as AppointmentRepository,
      patientRepository: {} as PatientRepository,
      doctorsClient: {} as DoctorsClient,
      paymentsClient: {} as PaymentsClient,
      stateMachine,
      enqueueExpiration: vi.fn().mockResolvedValue(undefined),
      enqueueReminder,
      logger,
    });

    const result = await service.confirmPayment('appt-1', 'pi_1');

    expect(result.status).toBe('PAID');
    expect(stateMachine.transition).toHaveBeenCalledWith('appt-1', 'PAID', {
      trigger: 'webhook',
      eventType: 'PAYMENT_RECEIVED',
      eventPayload: { stripePaymentIntentId: 'pi_1' },
    });
    expect(enqueueReminder).toHaveBeenCalledWith('appt-1', paid.dateTime);
  });
});
