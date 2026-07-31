import { randomUUID } from 'node:crypto';

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { buildSqsClient, pollQueueOnce } from '@clinica/messaging';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { NotificationChannel } from '../../src/clients/notification-channel.js';
import { buildAwsConfig } from '../../src/config/aws.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import type { EventHandler } from '../../src/lib/handler-types.js';
import { logger } from '../../src/lib/logger.js';
import { buildNotificationLogRepository } from '../../src/modules/notifications/notification-log.repository.js';
import { buildNotificationService } from '../../src/modules/notifications/notification.service.js';
import { buildSnapshotsRepository } from '../../src/modules/notifications/snapshots.repository.js';

// Publica directo a la cola SQS de Notifications, como si SNS ya hubiera
// hecho el fan-out (rawMessageDelivery) -- simula "lo que llega", no un
// test end-to-end del publisher (mismo patrón que ya usaban los tests
// equivalentes de Appointments contra Redis Streams).
const sqsClient = buildSqsClient(buildAwsConfig());

const publishToQueue = async (type: string, payload: Record<string, unknown>): Promise<void> => {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: env.NOTIFICATIONS_DOMAIN_EVENTS_QUEUE_URL,
      MessageBody: JSON.stringify({
        eventId: randomUUID(),
        tenantId: randomUUID(),
        type,
        payload,
        publishedAt: new Date().toISOString(),
      }),
    }),
  );
};

describe('Consumer de eventos de dominio (Notifications, Postgres + SQS reales vía LocalStack)', () => {
  const fakeChannel: NotificationChannel = { name: 'email', send: vi.fn().mockResolvedValue(undefined) };
  const notificationService = buildNotificationService({
    snapshots: buildSnapshotsRepository(prisma),
    channel: fakeChannel,
    logs: buildNotificationLogRepository(prisma),
    logger,
  });

  const handlers: Record<string, EventHandler> = {
    AppointmentCreated: (event) => notificationService.handleAppointmentCreated(event.payload as never),
    AppointmentStatusChanged: (event) =>
      notificationService.handleAppointmentStatusChanged(event.payload as never),
    PatientUpdated: (event) => notificationService.handlePatientUpdated(event.payload as never),
  };

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reconstruye el read-model y envía el email de confirmación cuando la cita pasa a PAID', async () => {
    const appointmentId = randomUUID();
    const patientId = randomUUID();
    const dateTime = new Date(Date.now() + 86_400_000).toISOString();

    await publishToQueue('PatientUpdated', { patientId, email: 'consumer-test@example.com', name: 'Test' });
    await publishToQueue('AppointmentCreated', { appointmentId, patientId, doctorId: randomUUID(), dateTime });
    await publishToQueue('AppointmentStatusChanged', {
      appointmentId,
      from: 'CONFIRMED',
      to: 'PAID',
      trigger: 'webhook',
    });

    let processed = 0;
    for (let i = 0; i < 5 && processed < 3; i += 1) {
      processed += await pollQueueOnce({
        sqsClient,
        queueUrl: env.NOTIFICATIONS_DOMAIN_EVENTS_QUEUE_URL,
        logger,
        handlers,
        waitTimeSeconds: 2,
      });
    }

    expect(processed).toBeGreaterThanOrEqual(3);

    const snapshot = await prisma.appointmentSnapshot.findUnique({ where: { id: appointmentId } });
    expect(snapshot?.status).toBe('PAID');

    const patientSnapshot = await prisma.patientSnapshot.findUnique({ where: { id: patientId } });
    expect(patientSnapshot?.email).toBe('consumer-test@example.com');

    expect(fakeChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'consumer-test@example.com', subject: expect.stringContaining('confirmada') }),
    );

    const log = await prisma.notificationLog.findFirst({ where: { appointmentId } });
    expect(log?.status).toBe('SENT');
  });

  it('idempotencia real: el mismo AppointmentStatusChanged entregado dos veces solo envía un email', async () => {
    const appointmentId = randomUUID();
    const patientId = randomUUID();
    const dateTime = new Date(Date.now() + 86_400_000).toISOString();

    await publishToQueue('PatientUpdated', {
      patientId,
      email: `idempotente-${randomUUID()}@example.com`,
      name: 'Idempotente',
    });
    await publishToQueue('AppointmentCreated', { appointmentId, patientId, doctorId: randomUUID(), dateTime });

    const sendCallsBefore = (fakeChannel.send as ReturnType<typeof vi.fn>).mock.calls.length;

    // Publica el MISMO AppointmentStatusChanged dos veces — simula la
    // re-entrega at-least-once de SQS (ej. el proceso murió después de
    // enviar el email pero antes de borrar el mensaje).
    await publishToQueue('AppointmentStatusChanged', { appointmentId, from: 'CONFIRMED', to: 'PAID', trigger: 'webhook' });
    await publishToQueue('AppointmentStatusChanged', { appointmentId, from: 'CONFIRMED', to: 'PAID', trigger: 'webhook' });

    let processed = 0;
    for (let i = 0; i < 6 && processed < 4; i += 1) {
      processed += await pollQueueOnce({
        sqsClient,
        queueUrl: env.NOTIFICATIONS_DOMAIN_EVENTS_QUEUE_URL,
        logger,
        handlers,
        waitTimeSeconds: 2,
      });
    }

    const sendCallsAfter = (fakeChannel.send as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(sendCallsAfter - sendCallsBefore).toBe(1);

    const logs = await prisma.notificationLog.findMany({ where: { appointmentId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe('SENT');
  });
});
