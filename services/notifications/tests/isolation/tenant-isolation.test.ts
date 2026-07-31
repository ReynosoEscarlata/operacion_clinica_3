import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';
import type { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { headersFor, TENANT_A, TENANT_B } from '../helpers/tenancy.js';

const buildFakeNotificationService = (): NotificationService =>
  ({
    handleAppointmentCreated: vi.fn().mockResolvedValue(undefined),
    handleAppointmentStatusChanged: vi.fn().mockResolvedValue(undefined),
    handlePatientUpdated: vi.fn().mockResolvedValue(undefined),
    handleDoctorEvent: vi.fn().mockResolvedValue(undefined),
    handlePaymentFailed: vi.fn().mockResolvedValue(undefined),
  }) as unknown as NotificationService;

describe('Aislamiento cross-tenant: Notifications (dead-letter)', () => {
  let app: FastifyInstance;
  let entryInA: string;

  beforeAll(async () => {
    app = await buildApp({ notifications: { notificationService: buildFakeNotificationService() } });
    await app.ready();

    const entry = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.deadLetterEntry.create({
        data: {
          tenantId: TENANT_A,
          eventId: randomUUID(),
          eventType: 'AppointmentStatusChanged',
          payload: { appointmentId: randomUUID(), from: 'CONFIRMED', to: 'PAID', trigger: 'webhook' },
          error: 'boom',
          attempts: 5,
        },
      }),
    );
    entryInA = entry.id;
  });

  afterAll(async () => {
    await withTenantId(prisma, TENANT_A, (tx) => tx.deadLetterEntry.deleteMany({ where: { id: entryInA } })).catch(
      () => undefined,
    );
    await app.close();
    await prisma.$disconnect();
  });

  it('una entrada de dead-letter creada por el tenant A queda etiquetada con su propio tenantId', async () => {
    const stored = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.deadLetterEntry.findUnique({ where: { id: entryInA } }),
    );
    expect(stored?.tenantId).toBe(TENANT_A);
  });

  it('GET /v1/dead-letter del tenant B no incluye entradas del tenant A', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/dead-letter', headers: headersFor(TENANT_B) });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.some((row: { id: string }) => row.id === entryInA)).toBe(false);
  });

  it('POST /v1/dead-letter/:id/retry contra una entrada de OTRO tenant devuelve 404, no la reintenta', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/dead-letter/${entryInA}/retry`,
      headers: headersFor(TENANT_B),
    });

    expect(response.statusCode).toBe(404);

    const stillThere = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.deadLetterEntry.findUnique({ where: { id: entryInA } }),
    );
    expect(stillThere).not.toBeNull();
  });

  it('DELETE /v1/dead-letter/:id contra una entrada de OTRO tenant devuelve 404, no la borra', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/dead-letter/${entryInA}`,
      headers: headersFor(TENANT_B),
    });

    expect(response.statusCode).toBe(404);

    const stillThere = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.deadLetterEntry.findUnique({ where: { id: entryInA } }),
    );
    expect(stillThere).not.toBeNull();
  });

  it('GET /v1/dead-letter con el propio tenant sí incluye la entrada', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/dead-letter', headers: headersFor(TENANT_A) });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.some((row: { id: string }) => row.id === entryInA)).toBe(true);
  });
});
