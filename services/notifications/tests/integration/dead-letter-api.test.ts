import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import type { NotificationService } from '../../src/modules/notifications/notification.service.js';

const buildFakeNotificationService = (): NotificationService =>
  ({
    handleAppointmentCreated: vi.fn().mockResolvedValue(undefined),
    handleAppointmentStatusChanged: vi.fn().mockResolvedValue(undefined),
    handlePatientUpdated: vi.fn().mockResolvedValue(undefined),
    handleDoctorEvent: vi.fn().mockResolvedValue(undefined),
    handlePaymentFailed: vi.fn().mockResolvedValue(undefined),
  }) as unknown as NotificationService;

describe('API HTTP de dead-letter (Notifications, Postgres real)', () => {
  let app: FastifyInstance;
  let notificationService: NotificationService;
  const createdIds: string[] = [];

  beforeEach(async () => {
    notificationService = buildFakeNotificationService();
    app = await buildApp({ notifications: { notificationService } });
    await app.ready();
  });

  afterAll(async () => {
    await prisma.deadLetterEntry.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it('lista las entradas de dead-letter con el shape {status, data, count}', async () => {
    const entry = await prisma.deadLetterEntry.create({
      data: {
        eventId: randomUUID(),
        eventType: 'AppointmentStatusChanged',
        payload: { appointmentId: randomUUID(), from: 'CONFIRMED', to: 'PAID', trigger: 'webhook' },
        error: 'boom',
        attempts: 5,
      },
    });
    createdIds.push(entry.id);

    const response = await app.inject({ method: 'GET', url: '/v1/dead-letter' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(typeof body.count).toBe('number');
    expect(body.data.some((row: { id: string }) => row.id === entry.id)).toBe(true);
  });

  it('reintenta una entrada: ejecuta el handler real correspondiente y borra la entrada al tener éxito', async () => {
    const appointmentId = randomUUID();
    const entry = await prisma.deadLetterEntry.create({
      data: {
        eventId: randomUUID(),
        eventType: 'AppointmentStatusChanged',
        payload: { appointmentId, from: 'CONFIRMED', to: 'PAID', trigger: 'webhook' },
        error: 'boom',
        attempts: 5,
      },
    });

    const response = await app.inject({ method: 'POST', url: `/v1/dead-letter/${entry.id}/retry` });

    expect(response.statusCode).toBe(200);
    expect(notificationService.handleAppointmentStatusChanged).toHaveBeenCalledWith({
      appointmentId,
      from: 'CONFIRMED',
      to: 'PAID',
      trigger: 'webhook',
    });

    const stillThere = await prisma.deadLetterEntry.findUnique({ where: { id: entry.id } });
    expect(stillThere).toBeNull();
  });

  it('si el handler vuelve a fallar al reintentar, la entrada NO se borra y responde 500', async () => {
    (notificationService.handleAppointmentStatusChanged as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('todavía no se puede procesar'),
    );
    const entry = await prisma.deadLetterEntry.create({
      data: {
        eventId: randomUUID(),
        eventType: 'AppointmentStatusChanged',
        payload: { appointmentId: randomUUID(), from: 'CONFIRMED', to: 'PAID', trigger: 'webhook' },
        error: 'boom',
        attempts: 5,
      },
    });
    createdIds.push(entry.id);

    const response = await app.inject({ method: 'POST', url: `/v1/dead-letter/${entry.id}/retry` });

    expect(response.statusCode).toBe(500);
    const stillThere = await prisma.deadLetterEntry.findUnique({ where: { id: entry.id } });
    expect(stillThere).not.toBeNull();
  });

  it('devuelve 404 al reintentar una entrada que no existe', async () => {
    const response = await app.inject({ method: 'POST', url: `/v1/dead-letter/${randomUUID()}/retry` });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('DEAD_LETTER_NOT_FOUND');
  });

  it('borra una entrada de dead-letter sin reintentarla', async () => {
    const entry = await prisma.deadLetterEntry.create({
      data: { eventId: randomUUID(), eventType: 'PaymentFailed', payload: {}, error: 'boom', attempts: 5 },
    });

    const response = await app.inject({ method: 'DELETE', url: `/v1/dead-letter/${entry.id}` });

    expect(response.statusCode).toBe(200);
    expect(notificationService.handlePaymentFailed).not.toHaveBeenCalled();
    const stillThere = await prisma.deadLetterEntry.findUnique({ where: { id: entry.id } });
    expect(stillThere).toBeNull();
  });

  it('devuelve 404 al borrar una entrada que no existe', async () => {
    const response = await app.inject({ method: 'DELETE', url: `/v1/dead-letter/${randomUUID()}` });
    expect(response.statusCode).toBe(404);
  });
});
