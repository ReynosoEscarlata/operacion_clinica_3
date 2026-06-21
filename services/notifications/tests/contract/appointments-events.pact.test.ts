import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { MatchersV3, MessageConsumerPact, asynchronousBodyHandler } from '@pact-foundation/pact';
import { describe, it, vi } from 'vitest';

import type { NotificationChannel } from '../../src/clients/notification-channel.js';
import { buildEventHandlers } from '../../src/lib/event-handlers.js';
import { buildNotificationLogRepository } from '../../src/modules/notifications/notification-log.repository.js';
import { buildNotificationService } from '../../src/modules/notifications/notification.service.js';
import { buildSnapshotsRepository } from '../../src/modules/notifications/snapshots.repository.js';
import { prisma } from '../../src/config/prisma.js';
import { logger } from '../../src/lib/logger.js';

const { like, datetime } = MatchersV3;
const ISO_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSSX";

// Pact de mensajes (PLAN.md Fase 4, punto 3b: "incluyendo el esquema del
// evento"). A diferencia de los contratos HTTP de arriba, esto no tiene
// mock server — Notifications es quien CONSUME estos eventos (Appointments
// los produce vía Outbox → Redis Streams), así que en la terminología de
// Pact, Notifications es el "consumer" del mensaje y Appointments su
// "provider" (al revés de quién inicia la conexión HTTP). La verificación
// del lado de Appointments vive en
// services/appointments/tests/contract/notifications-events-provider.pact.test.ts.
const PACTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'pacts');

describe('Pact de mensajes: Appointments (provider) → Notifications (consumer)', () => {
  const messagePact = new MessageConsumerPact({
    consumer: 'notifications',
    provider: 'appointments',
    dir: PACTS_DIR,
  });

  it('AppointmentCreated: Notifications puede procesar el evento y crear el snapshot', async () => {
    const appointmentId = randomUUID();
    const patientId = randomUUID();
    const doctorId = randomUUID();

    const fakeChannel: NotificationChannel = { name: 'email', send: vi.fn() };
    const notificationService = buildNotificationService({
      snapshots: buildSnapshotsRepository(prisma),
      channel: fakeChannel,
      logs: buildNotificationLogRepository(prisma),
      logger,
    });
    const handlers = buildEventHandlers(notificationService);

    await messagePact
      .given('se crea una cita nueva')
      .expectsToReceive('un evento AppointmentCreated')
      .withContent({
        appointmentId: like(appointmentId),
        patientId: like(patientId),
        doctorId: like(doctorId),
        dateTime: datetime(ISO_DATETIME_FORMAT, new Date(Date.now() + 86_400_000).toISOString()),
      })
      .verify(
        asynchronousBodyHandler(async (body) => {
          await handlers.AppointmentCreated?.({
            eventId: randomUUID(),
            type: 'AppointmentCreated',
            payload: body as Record<string, unknown>,
          });
        }),
      );

    await prisma.appointmentSnapshot.delete({ where: { id: appointmentId } }).catch(() => undefined);
  });

  it('AppointmentStatusChanged a PAID: Notifications puede procesar el evento (requiere el snapshot previo)', async () => {
    const appointmentId = randomUUID();
    const patientId = randomUUID();

    const fakeChannel: NotificationChannel = { name: 'email', send: vi.fn().mockResolvedValue(undefined) };
    const notificationService = buildNotificationService({
      snapshots: buildSnapshotsRepository(prisma),
      channel: fakeChannel,
      logs: buildNotificationLogRepository(prisma),
      logger,
    });
    const handlers = buildEventHandlers(notificationService);

    // El handler de AppointmentStatusChanged exige que el snapshot de la
    // cita ya exista (lo crea AppointmentCreated) — se siembra acá porque
    // este test verifica el handler de status-changed en aislamiento, no
    // la secuencia completa de eventos.
    await prisma.appointmentSnapshot.create({
      data: {
        id: appointmentId,
        patientId,
        doctorId: randomUUID(),
        dateTime: new Date(Date.now() + 86_400_000),
        amountCents: 50_000,
        status: 'CONFIRMED',
      },
    });
    await prisma.patientSnapshot.upsert({
      where: { id: patientId },
      create: { id: patientId, email: `pact-${appointmentId}@example.com`, name: 'Paciente Pact' },
      update: {},
    });

    await messagePact
      .given('una cita pasa a PAID')
      .expectsToReceive('un evento AppointmentStatusChanged')
      .withContent({
        appointmentId: like(appointmentId),
        from: 'CONFIRMED',
        to: 'PAID',
        trigger: like('webhook'),
      })
      .verify(
        asynchronousBodyHandler(async (body) => {
          await handlers.AppointmentStatusChanged?.({
            eventId: randomUUID(),
            type: 'AppointmentStatusChanged',
            payload: body as Record<string, unknown>,
          });
        }),
      );

    await prisma.appointmentSnapshot.delete({ where: { id: appointmentId } }).catch(() => undefined);
    await prisma.patientSnapshot.delete({ where: { id: patientId } }).catch(() => undefined);
  });
});
