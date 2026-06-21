import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
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

describe('Admin (dashboard/eventos/dead-letter, integración con Postgres real)', () => {
  let app: FastifyInstance;
  const doctorId = randomUUID();
  let patientId: string;
  const createdAppointmentIds: string[] = [];
  const createdDeadLetterIds: string[] = [];

  beforeAll(async () => {
    const patient = await prisma.patient.create({
      data: {
        email: `admin-test-${randomUUID()}@example.com`,
        name: 'Paciente Admin Test',
        phone: '+54 9 11 5555-3333',
        stripeCustomerId: 'cus_admin_test',
      },
    });
    patientId = patient.id;

    app = await buildApp({
      appointments: {
        doctorsClient: buildFakeDoctorsClient(),
        paymentsClient: buildFakePaymentsClient(),
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
        enqueueReminder: vi.fn().mockResolvedValue(undefined),
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await prisma.deadLetterEntry.deleteMany({ where: { id: { in: createdDeadLetterIds } } });
    if (createdAppointmentIds.length > 0) {
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    }
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  describe('GET /v1/admin/dashboard', () => {
    it('cuenta citas de hoy y agrega no-show rate por doctor', async () => {
      const today = new Date();

      const completed = await prisma.appointment.create({
        data: {
          patientId,
          doctorId,
          dateTime: today,
          durationMinutes: 30,
          amountCents: 50_000,
          status: 'COMPLETED',
          paidAt: today,
        },
      });
      const noShow = await prisma.appointment.create({
        data: {
          patientId,
          doctorId,
          dateTime: today,
          durationMinutes: 30,
          amountCents: 50_000,
          status: 'NO_SHOW',
        },
      });
      createdAppointmentIds.push(completed.id, noShow.id);

      const response = await app.inject({ method: 'GET', url: '/v1/admin/dashboard' });

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
      const appointment = await prisma.appointment.create({
        data: {
          patientId,
          doctorId,
          dateTime: new Date(),
          durationMinutes: 30,
          amountCents: 50_000,
          status: 'PENDING',
        },
      });
      createdAppointmentIds.push(appointment.id);
      await prisma.appointmentEvent.create({
        data: { appointmentId: appointment.id, type: 'CREATED', payload: { patientId, doctorId } },
      });

      const response = await app.inject({ method: 'GET', url: '/v1/admin/events?hours=1' });

      expect(response.statusCode).toBe(200);
      const events = response.json() as Array<{ appointmentId: string; type: string }>;
      expect(events.some((event) => event.appointmentId === appointment.id && event.type === 'CREATED')).toBe(
        true,
      );
    });

    it('rechaza un hours fuera de rango con 400', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/events?hours=0' });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('dead-letter', () => {
    it('lista, reintenta (republica un OutboxEvent nuevo) y borra una entrada', async () => {
      const entry = await prisma.deadLetterEntry.create({
        data: {
          eventId: randomUUID(),
          eventType: 'PaymentSucceeded',
          payload: { appointmentId: randomUUID() },
          error: 'boom',
          attempts: 5,
        },
      });
      createdDeadLetterIds.push(entry.id);

      const listResponse = await app.inject({ method: 'GET', url: '/v1/admin/dead-letter' });
      expect(listResponse.statusCode).toBe(200);
      const listBody = listResponse.json();
      expect(listBody.status).toBe('ok');
      expect(listBody.data.some((row: { id: string }) => row.id === entry.id)).toBe(true);

      const retryResponse = await app.inject({ method: 'POST', url: `/v1/admin/dead-letter/${entry.id}/retry` });
      expect(retryResponse.statusCode).toBe(200);

      const stillThere = await prisma.deadLetterEntry.findUnique({ where: { id: entry.id } });
      expect(stillThere).toBeNull();

      const republished = await prisma.outboxEvent.findFirst({
        where: { type: 'PaymentSucceeded', payload: { path: ['appointmentId'], equals: (entry.payload as { appointmentId: string }).appointmentId } },
      });
      expect(republished).toBeDefined();
      expect(republished?.publishedAt).toBeNull();
    });

    it('devuelve 404 al reintentar una entrada que no existe', async () => {
      const response = await app.inject({ method: 'POST', url: `/v1/admin/dead-letter/${randomUUID()}/retry` });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('DEAD_LETTER_NOT_FOUND');
    });

    it('borra una entrada de dead-letter sin reintentarla', async () => {
      const entry = await prisma.deadLetterEntry.create({
        data: { eventId: randomUUID(), eventType: 'PaymentFailed', payload: {}, error: 'boom', attempts: 5 },
      });

      const response = await app.inject({ method: 'DELETE', url: `/v1/admin/dead-letter/${entry.id}` });
      expect(response.statusCode).toBe(200);

      const stillThere = await prisma.deadLetterEntry.findUnique({ where: { id: entry.id } });
      expect(stillThere).toBeNull();
    });

    it('devuelve 404 al borrar una entrada que no existe', async () => {
      const response = await app.inject({ method: 'DELETE', url: `/v1/admin/dead-letter/${randomUUID()}` });
      expect(response.statusCode).toBe(404);
    });
  });
});
