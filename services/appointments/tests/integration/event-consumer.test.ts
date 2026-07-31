import { randomUUID } from 'node:crypto';

import { CreateQueueCommand, DeleteQueueCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { buildSqsClient, pollQueueOnce } from '@clinica/messaging';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAwsConfig } from '../../src/config/aws.js';
import { prisma } from '../../src/config/prisma.js';
import { buildDomainEventHandlers } from '../../src/lib/domain-event-handlers.js';
import { logger } from '../../src/lib/logger.js';
import { buildAppointmentRepository } from '../../src/modules/appointments/appointments.repository.js';
import { buildAppointmentService } from '../../src/modules/appointments/appointments.service.js';
import { buildStateMachine } from '../../src/modules/appointments/state-machine.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';
import type { DoctorsClient } from '../../src/clients/doctors-client.js';
import type { PaymentsClient } from '../../src/clients/payments-client.js';

const TEST_TENANT_ID = '66666666-6666-6666-6666-666666666666';

const sqsClient = buildSqsClient(buildAwsConfig());

// Publica directo a una cola SQS de test, como si SNS ya hubiera hecho el
// fan-out (rawMessageDelivery) -- simula "lo que llega", no un test
// end-to-end del publisher (ese ya se prueba en outbox-relay.test.ts de
// cada servicio productor).
const publishToQueue = async (queueUrl: string, type: string, payload: Record<string, unknown>): Promise<void> => {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        eventId: randomUUID(),
        tenantId: TEST_TENANT_ID,
        type,
        payload,
        publishedAt: new Date().toISOString(),
      }),
    }),
  );
};

describe('Consumer de eventos de dominio (Appointments, Postgres + SQS reales vía LocalStack)', () => {
  let queueUrl: string;
  let patientId: string;
  const doctorId = randomUUID();

  const doctorsClient = {
    getDoctor: async () => ({ id: doctorId, tenantId: TEST_TENANT_ID, consultationPriceCents: 50_000 }),
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
  const handlers = buildDomainEventHandlers({ appointmentService, logger });

  beforeAll(async () => {
    const queue = await sqsClient.send(
      new CreateQueueCommand({ QueueName: `test-appointments-consumer-${randomUUID()}` }),
    );
    queueUrl = queue.QueueUrl as string;

    const patient = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.patient.create({
        data: {
          tenantId: TEST_TENANT_ID,
          email: `consumer-test-${randomUUID()}@example.com`,
          name: 'Paciente Consumer Test',
          phone: '+54 9 11 5555-7777',
        },
      }),
    );
    patientId = patient.id;
  });

  afterAll(async () => {
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
    await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
      await tx.appointment.deleteMany({ where: { patientId } });
      await tx.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    });
    await prisma.$disconnect();
  });

  it('PaymentSucceeded: transiciona la cita CONFIRMED -> PAID', async () => {
    const appointment = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.appointment.create({
        data: {
          tenantId: TEST_TENANT_ID,
          patientId,
          doctorId,
          dateTime: new Date(Date.now() + 86_400_000),
          durationMinutes: 30,
          amountCents: 50_000,
          status: 'CONFIRMED',
          stripePaymentIntentId: `pi_${randomUUID()}`,
        },
      }),
    );

    await publishToQueue(queueUrl, 'PaymentSucceeded', {
      appointmentId: appointment.id,
      paymentIntentId: appointment.stripePaymentIntentId,
    });

    let processed = 0;
    for (let i = 0; i < 5 && processed < 1; i += 1) {
      processed += await pollQueueOnce({ sqsClient, queueUrl, logger, handlers, waitTimeSeconds: 2 });
    }
    expect(processed).toBeGreaterThanOrEqual(1);

    const updated = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.appointment.findUnique({ where: { id: appointment.id } }),
    );
    expect(updated?.status).toBe('PAID');
  });

  it('es idempotente: un PaymentSucceeded duplicado para una cita ya PAID no rompe el consumer', async () => {
    const appointment = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.appointment.create({
        data: {
          tenantId: TEST_TENANT_ID,
          patientId,
          doctorId,
          dateTime: new Date(Date.now() + 2 * 86_400_000),
          durationMinutes: 30,
          amountCents: 50_000,
          status: 'PAID',
          stripePaymentIntentId: `pi_${randomUUID()}`,
          paidAt: new Date(),
        },
      }),
    );

    await publishToQueue(queueUrl, 'PaymentSucceeded', {
      appointmentId: appointment.id,
      paymentIntentId: appointment.stripePaymentIntentId,
    });

    let processed = 0;
    for (let i = 0; i < 5 && processed < 1; i += 1) {
      processed += await pollQueueOnce({ sqsClient, queueUrl, logger, handlers, waitTimeSeconds: 2 });
    }
    expect(processed).toBeGreaterThanOrEqual(1);

    const updated = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.appointment.findUnique({ where: { id: appointment.id } }),
    );
    expect(updated?.status).toBe('PAID');
  });

  it('PaymentFailed: registra el evento sin cambiar el estado de la cita', async () => {
    const appointment = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.appointment.create({
        data: {
          tenantId: TEST_TENANT_ID,
          patientId,
          doctorId,
          dateTime: new Date(Date.now() + 3 * 86_400_000),
          durationMinutes: 30,
          amountCents: 50_000,
          status: 'CONFIRMED',
          stripePaymentIntentId: `pi_${randomUUID()}`,
        },
      }),
    );

    await publishToQueue(queueUrl, 'PaymentFailed', {
      appointmentId: appointment.id,
      paymentIntentId: appointment.stripePaymentIntentId,
      reason: 'Tarjeta rechazada',
    });

    let processed = 0;
    for (let i = 0; i < 5 && processed < 1; i += 1) {
      processed += await pollQueueOnce({ sqsClient, queueUrl, logger, handlers, waitTimeSeconds: 2 });
    }
    expect(processed).toBeGreaterThanOrEqual(1);

    const updated = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.appointment.findUnique({
        where: { id: appointment.id },
        include: { events: true },
      }),
    );
    expect(updated?.status).toBe('CONFIRMED');
    expect(updated?.events.some((event) => event.type === 'PAYMENT_FAILED')).toBe(true);
  });
});
