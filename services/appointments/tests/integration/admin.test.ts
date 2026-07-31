import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { buildDomainEventHandlers } from '../../src/lib/domain-event-handlers.js';
import { logger } from '../../src/lib/logger.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';
import { buildAppointmentRepository } from '../../src/modules/appointments/appointments.repository.js';
import { buildAppointmentService } from '../../src/modules/appointments/appointments.service.js';
import { buildStateMachine } from '../../src/modules/appointments/state-machine.js';
import type { DoctorsClient } from '../../src/clients/doctors-client.js';
import type { PaymentsClient } from '../../src/clients/payments-client.js';

const buildFakeDoctorsClient = (): DoctorsClient => ({
  getDoctor: vi.fn(),
  getAvailableSlots: vi.fn(),
});

const buildFakePaymentsClient = (): PaymentsClient => ({
  createCustomer: vi.fn(),
  createPaymentIntent: vi.fn(),
  cancelPaymentIntent: vi.fn(),
  createRefund: vi.fn(),
});

// Tenant fijo de este archivo (RLS activo, Fase 3a). Todas las queries
// directas a `prisma` en este archivo pasan por withTenantId (RLS aplica
// también a los fixtures de test, no solo al código de producción).
const TEST_TENANT_ID = '77777777-7777-7777-7777-777777777777';
// role platform_admin (RFC-004): es el único rol con 'all' en las 5
// rutas de este archivo (dashboard:read/audit:read/dead_letter:*) --
// clinic_owner no tiene dead_letter:*, es exclusivo del plano de plataforma.
const TENANT_HEADERS = { 'x-internal-tenant-id': TEST_TENANT_ID, 'x-internal-user-role': 'platform_admin' };

describe('Admin (dashboard/eventos/dead-letter, integración con Postgres real)', () => {
  let app: FastifyInstance;
  const doctorId = randomUUID();
  let patientId: string;
  const createdAppointmentIds: string[] = [];
  const createdDeadLetterIds: string[] = [];

  beforeAll(async () => {
    const patient = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.patient.create({
        data: {
          tenantId: TEST_TENANT_ID,
          email: `admin-test-${randomUUID()}@example.com`,
          name: 'Paciente Admin Test',
          phone: '+54 9 11 5555-3333',
          stripeCustomerId: 'cus_admin_test',
        },
      }),
    );
    patientId = patient.id;

    const enqueueReminder = vi.fn().mockResolvedValue(undefined);
    const stateMachine = buildStateMachine(prisma, logger);
    // La misma instancia de AppointmentService se comparte entre las rutas
    // de /v1/appointments y el mapa de domainEventHandlers usado por el
    // retry de dead-letter -- mismos fakes, para que "reintentar" un
    // PaymentSucceeded no dispare llamadas HTTP reales a Doctors/Payments.
    const appointmentService = buildAppointmentService({
      repository: buildAppointmentRepository(prisma),
      patientRepository: { findById: async () => null } as never,
      doctorsClient: buildFakeDoctorsClient(),
      paymentsClient: buildFakePaymentsClient(),
      stateMachine,
      enqueueExpiration: vi.fn().mockResolvedValue(undefined),
      enqueueReminder,
      logger,
    });
    const domainEventHandlers = buildDomainEventHandlers({ appointmentService, logger });

    app = await buildApp({
      appointments: {
        doctorsClient: buildFakeDoctorsClient(),
        paymentsClient: buildFakePaymentsClient(),
        stateMachine,
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
        enqueueReminder,
      },
      admin: { domainEventHandlers },
    });
    await app.ready();
  });

  afterAll(async () => {
    await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
      await tx.deadLetterEntry.deleteMany({ where: { id: { in: createdDeadLetterIds } } });
      if (createdAppointmentIds.length > 0) {
        await tx.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
      }
      await tx.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    });
    await app.close();
    await prisma.$disconnect();
  });

  describe('GET /v1/admin/dashboard', () => {
    it('cuenta citas de hoy y agrega no-show rate por doctor', async () => {
      const today = new Date();

      const { completed, noShow } = await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
        const completed = await tx.appointment.create({
          data: {
            tenantId: TEST_TENANT_ID,
            patientId,
            doctorId,
            dateTime: today,
            durationMinutes: 30,
            amountCents: 50_000,
            status: 'COMPLETED',
            paidAt: today,
          },
        });
        const noShow = await tx.appointment.create({
          data: {
            tenantId: TEST_TENANT_ID,
            patientId,
            doctorId,
            dateTime: today,
            durationMinutes: 30,
            amountCents: 50_000,
            status: 'NO_SHOW',
          },
        });
        return { completed, noShow };
      });
      createdAppointmentIds.push(completed.id, noShow.id);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/dashboard',
        headers: TENANT_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.appointmentsToday).toBeGreaterThanOrEqual(2);
      expect(body.byStatus.COMPLETED).toBeGreaterThanOrEqual(1);
      expect(body.byStatus.NO_SHOW).toBeGreaterThanOrEqual(1);
      expect(body.revenue.today).toBeGreaterThanOrEqual(50_000);

      const doctorStats = body.noShowRateByDoctor.find((row: { doctorId: string }) => row.doctorId === doctorId);
      expect(doctorStats).toBeDefined();
      expect(doctorStats.noShowCount).toBeGreaterThanOrEqual(1);
      expect(doctorStats.completedCount).toBeGreaterThanOrEqual(1);
      expect(doctorStats.rate).toBeGreaterThan(0);
    });
  });

  describe('GET /v1/admin/events', () => {
    it('lista eventos recientes de citas dentro de la ventana de horas pedida', async () => {
      const appointment = await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
        const appointment = await tx.appointment.create({
          data: {
            tenantId: TEST_TENANT_ID,
            patientId,
            doctorId,
            dateTime: new Date(),
            durationMinutes: 30,
            amountCents: 50_000,
            status: 'PENDING',
          },
        });
        await tx.appointmentEvent.create({
          data: {
            tenantId: TEST_TENANT_ID,
            appointmentId: appointment.id,
            type: 'CREATED',
            payload: { patientId, doctorId },
          },
        });
        return appointment;
      });
      createdAppointmentIds.push(appointment.id);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/events?hours=1',
        headers: TENANT_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      const events = response.json() as Array<{ appointmentId: string; type: string }>;
      expect(events.some((event) => event.appointmentId === appointment.id && event.type === 'CREATED')).toBe(
        true,
      );
    });

    it('rechaza un hours fuera de rango con 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/events?hours=0',
        headers: TENANT_HEADERS,
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('dead-letter', () => {
    it('lista, reintenta (re-invoca el handler real) y borra una entrada', async () => {
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
      createdAppointmentIds.push(appointment.id);

      const entry = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
        tx.deadLetterEntry.create({
          data: {
            tenantId: TEST_TENANT_ID,
            eventId: randomUUID(),
            eventType: 'PaymentSucceeded',
            payload: { appointmentId: appointment.id, paymentIntentId: appointment.stripePaymentIntentId },
            error: 'boom',
            attempts: 5,
          },
        }),
      );
      createdDeadLetterIds.push(entry.id);

      const listResponse = await app.inject({
        method: 'GET',
        url: '/v1/admin/dead-letter',
        headers: TENANT_HEADERS,
      });
      expect(listResponse.statusCode).toBe(200);
      const listBody = listResponse.json();
      expect(listBody.status).toBe('ok');
      expect(listBody.data.some((row: { id: string }) => row.id === entry.id)).toBe(true);

      const retryResponse = await app.inject({
        method: 'POST',
        url: `/v1/admin/dead-letter/${entry.id}/retry`,
        headers: TENANT_HEADERS,
      });
      expect(retryResponse.statusCode).toBe(200);

      const stillThere = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
        tx.deadLetterEntry.findUnique({ where: { id: entry.id } }),
      );
      expect(stillThere).toBeNull();

      // Prueba real de que se re-invocó el handler (no un republish): la
      // cita transicionó CONFIRMED -> PAID, tal como haría el consumer real.
      const updatedAppointment = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
        tx.appointment.findUnique({ where: { id: appointment.id } }),
      );
      expect(updatedAppointment?.status).toBe('PAID');
    });

    it('devuelve 404 al reintentar una entrada que no existe', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/dead-letter/${randomUUID()}/retry`,
        headers: TENANT_HEADERS,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('DEAD_LETTER_NOT_FOUND');
    });

    it('borra una entrada de dead-letter sin reintentarla', async () => {
      const entry = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
        tx.deadLetterEntry.create({
          data: {
            tenantId: TEST_TENANT_ID,
            eventId: randomUUID(),
            eventType: 'PaymentFailed',
            payload: {},
            error: 'boom',
            attempts: 5,
          },
        }),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/admin/dead-letter/${entry.id}`,
        headers: TENANT_HEADERS,
      });
      expect(response.statusCode).toBe(200);

      const stillThere = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
        tx.deadLetterEntry.findUnique({ where: { id: entry.id } }),
      );
      expect(stillThere).toBeNull();
    });

    it('devuelve 404 al borrar una entrada que no existe', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/admin/dead-letter/${randomUUID()}`,
        headers: TENANT_HEADERS,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
