import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import { AppError } from '../../src/lib/app-error.js';
import { ensureConsumerGroup, runConsumerBatchOnce, type EventHandler } from '../../src/lib/event-consumer.js';
import { DOMAIN_EVENTS_STREAM } from '../../src/lib/outbox-relay.js';
import { buildAppointmentRepository } from '../../src/modules/appointments/appointments.repository.js';
import { buildStateMachine } from '../../src/modules/appointments/state-machine.js';
import { buildAppointmentService } from '../../src/modules/appointments/appointments.service.js';
import { logger } from '../../src/lib/logger.js';
import type { DoctorsClient } from '../../src/clients/doctors-client.js';
import type { PaymentsClient } from '../../src/clients/payments-client.js';

const GROUP = `test-group-${randomUUID()}`;

// Simula lo que hace Payments al publicar (escribe directo al stream, sin
// pasar por su propio Outbox — lo que importa acá es que Appointments lo
// consuma correctamente, no reprobar el relay que ya se prueba en
// services/payments).
const publishToStream = async (type: string, payload: Record<string, unknown>): Promise<void> => {
  await redis.xadd(
    DOMAIN_EVENTS_STREAM,
    '*',
    'eventId',
    randomUUID(),
    'type',
    type,
    'payload',
    JSON.stringify(payload),
  );
};

describe('Consumer de eventos de dominio (Redis Streams reales)', () => {
  let patientId: string;
  const doctorId = randomUUID();

  const doctorsClient = {
    getDoctor: async () => ({ id: doctorId, consultationPriceCents: 50_000 }),
    getAvailableSlots: async () => [],
  } as DoctorsClient;
  const paymentsClient = {} as PaymentsClient;

  const stateMachine = buildStateMachine(prisma, logger);
  const repository = buildAppointmentRepository(prisma);
  const appointmentService = buildAppointmentService({
    repository,
    patientRepository: { findById: async () => null } as never,
    doctorsClient,
    paymentsClient,
    stateMachine,
    enqueueExpiration: async () => undefined,
    enqueueReminder: async () => undefined,
    logger,
  });

  const handlePaymentSucceeded: EventHandler = async (event) => {
    const { appointmentId, paymentIntentId } = event.payload as {
      appointmentId: string;
      paymentIntentId: string;
    };
    try {
      await appointmentService.confirmPayment(appointmentId, paymentIntentId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_STATE_TRANSITION') {
        return;
      }
      throw error;
    }
  };

  const handlePaymentFailed: EventHandler = async (event) => {
    const { appointmentId, paymentIntentId, reason } = event.payload as {
      appointmentId: string;
      paymentIntentId: string;
      reason: string | null;
    };
    await appointmentService.recordPaymentFailed(appointmentId, paymentIntentId, reason);
  };

  beforeAll(async () => {
    // Arranca en '$' (solo eventos nuevos a partir de ahora): el stream es
    // compartido y persiste entre corridas de test reales contra Redis, así
    // que un grupo nuevo empezando en '0' reprocesaría historial de citas
    // de corridas anteriores que ya no existen.
    await ensureConsumerGroup(redis, GROUP, '$');

    const patient = await prisma.patient.create({
      data: {
        email: `consumer-test-${randomUUID()}@example.com`,
        name: 'Paciente Consumer Test',
        phone: '+54 9 11 5555-7777',
      },
    });
    patientId = patient.id;
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { patientId } });
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('PaymentSucceeded: transiciona la cita CONFIRMED -> PAID', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: new Date(Date.now() + 86_400_000),
        durationMinutes: 30,
        amountCents: 50_000,
        status: 'CONFIRMED',
        stripePaymentIntentId: `pi_${randomUUID()}`,
      },
    });

    await publishToStream('PaymentSucceeded', {
      appointmentId: appointment.id,
      paymentIntentId: appointment.stripePaymentIntentId,
    });

    const processed = await runConsumerBatchOnce(
      {
        redis,
        groupName: GROUP,
        consumerName: 'test-consumer-1',
        logger,
        handlers: { PaymentSucceeded: handlePaymentSucceeded, PaymentFailed: handlePaymentFailed },
      },
      200,
    );

    expect(processed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(updated?.status).toBe('PAID');
  });

  it('es idempotente: un PaymentSucceeded duplicado para una cita ya PAID no rompe el consumer', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: new Date(Date.now() + 2 * 86_400_000),
        durationMinutes: 30,
        amountCents: 50_000,
        status: 'PAID',
        stripePaymentIntentId: `pi_${randomUUID()}`,
        paidAt: new Date(),
      },
    });

    await publishToStream('PaymentSucceeded', {
      appointmentId: appointment.id,
      paymentIntentId: appointment.stripePaymentIntentId,
    });

    const processed = await runConsumerBatchOnce(
      {
        redis,
        groupName: GROUP,
        consumerName: 'test-consumer-1',
        logger,
        handlers: { PaymentSucceeded: handlePaymentSucceeded, PaymentFailed: handlePaymentFailed },
      },
      200,
    );

    expect(processed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(updated?.status).toBe('PAID');
  });

  it('PaymentFailed: registra el evento sin cambiar el estado de la cita', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: new Date(Date.now() + 3 * 86_400_000),
        durationMinutes: 30,
        amountCents: 50_000,
        status: 'CONFIRMED',
        stripePaymentIntentId: `pi_${randomUUID()}`,
      },
    });

    await publishToStream('PaymentFailed', {
      appointmentId: appointment.id,
      paymentIntentId: appointment.stripePaymentIntentId,
      reason: 'Tarjeta rechazada',
    });

    await runConsumerBatchOnce(
      {
        redis,
        groupName: GROUP,
        consumerName: 'test-consumer-1',
        logger,
        handlers: { PaymentSucceeded: handlePaymentSucceeded, PaymentFailed: handlePaymentFailed },
      },
      200,
    );

    const updated = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      include: { events: true },
    });
    expect(updated?.status).toBe('CONFIRMED');
    expect(updated?.events.some((event) => event.type === 'PAYMENT_FAILED')).toBe(true);
  });
});
