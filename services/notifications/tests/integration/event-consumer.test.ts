import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { NotificationChannel } from '../../src/clients/notification-channel.js';
import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import { ensureConsumerGroup, runConsumerBatchOnce, type EventHandler } from '../../src/lib/event-consumer.js';
import { DOMAIN_EVENTS_STREAM } from '../../src/lib/outbox-relay.js';
import { logger } from '../../src/lib/logger.js';
import { buildNotificationLogRepository } from '../../src/modules/notifications/notification-log.repository.js';
import { buildNotificationService } from '../../src/modules/notifications/notification.service.js';
import { buildSnapshotsRepository } from '../../src/modules/notifications/snapshots.repository.js';

const GROUP = `test-group-${randomUUID()}`;

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

describe('Consumer de eventos de dominio (Notifications, Postgres + Redis reales)', () => {
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

  beforeAll(async () => {
    await ensureConsumerGroup(redis, GROUP, '$');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('reconstruye el read-model y envía el email de confirmación cuando la cita pasa a PAID', async () => {
    const appointmentId = randomUUID();
    const patientId = randomUUID();
    const dateTime = new Date(Date.now() + 86_400_000).toISOString();

    await publishToStream('PatientUpdated', { patientId, email: 'consumer-test@example.com', name: 'Test' });
    await publishToStream('AppointmentCreated', { appointmentId, patientId, doctorId: randomUUID(), dateTime });
    await publishToStream('AppointmentStatusChanged', {
      appointmentId,
      from: 'CONFIRMED',
      to: 'PAID',
      trigger: 'webhook',
    });

    // Tres eventos en orden: cada XREADGROUP trae lo que haya disponible,
    // así que se procesa en lotes hasta vaciar lo publicado arriba.
    let processed = 0;
    for (let i = 0; i < 5 && processed < 3; i += 1) {
      processed += await runConsumerBatchOnce({ redis, groupName: GROUP, consumerName: 'c1', logger, handlers }, 200);
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

    await publishToStream('PatientUpdated', {
      patientId,
      email: `idempotente-${randomUUID()}@example.com`,
      name: 'Idempotente',
    });
    await publishToStream('AppointmentCreated', { appointmentId, patientId, doctorId: randomUUID(), dateTime });

    const sendCallsBefore = (fakeChannel.send as ReturnType<typeof vi.fn>).mock.calls.length;

    // Publica el MISMO AppointmentStatusChanged dos veces — simula la
    // re-entrega at-least-once de Redis Streams (ej. el proceso murió
    // después de enviar el email pero antes del XACK).
    await publishToStream('AppointmentStatusChanged', { appointmentId, from: 'CONFIRMED', to: 'PAID', trigger: 'webhook' });
    await publishToStream('AppointmentStatusChanged', { appointmentId, from: 'CONFIRMED', to: 'PAID', trigger: 'webhook' });

    let processed = 0;
    for (let i = 0; i < 6 && processed < 4; i += 1) {
      processed += await runConsumerBatchOnce({ redis, groupName: GROUP, consumerName: 'c1', logger, handlers }, 200);
    }

    const sendCallsAfter = (fakeChannel.send as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(sendCallsAfter - sendCallsBefore).toBe(1);

    const logs = await prisma.notificationLog.findMany({ where: { appointmentId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe('SENT');
  });
});
