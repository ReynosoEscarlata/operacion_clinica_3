import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import { buildDefaultAppointmentService } from '../../src/modules/appointments/index.js';
import type { StripeAppointmentsClient } from '../../src/modules/appointments/appointments.service.js';

const ADMIN_HEADER = { 'x-admin-key': process.env.ADMIN_API_KEY ?? '' };
const CONSULTATION_PRICE_CENTS = 60_000;

const buildFakeStripeClient = (): StripeAppointmentsClient => ({
  paymentIntents: {
    create: vi.fn().mockResolvedValue({ id: `pi_${randomUUID()}`, client_secret: 'secret' }),
    cancel: vi.fn().mockResolvedValue({}),
  },
  refunds: {
    create: vi.fn().mockResolvedValue({ id: `re_${randomUUID()}` }),
  },
});

describe('Admin appointments API (integración con DB real)', () => {
  let app: FastifyInstance;
  let doctorId: string;
  let patientId: string;
  let fakeStripeClient: StripeAppointmentsClient;
  const appointmentIds: string[] = [];
  const extraDoctorIds: string[] = [];

  beforeAll(async () => {
    const doctor = await prisma.doctor.create({
      data: {
        name: 'Dr. Admin Test',
        email: `admin-doctor-${randomUUID()}@example.com`,
        specialty: 'Test',
        consultationPriceCents: CONSULTATION_PRICE_CENTS,
      },
    });
    doctorId = doctor.id;

    const patient = await prisma.patient.create({
      data: {
        email: `admin-patient-${randomUUID()}@example.com`,
        name: 'Paciente Admin Test',
        phone: '+54 9 11 5555-7777',
      },
    });
    patientId = patient.id;

    fakeStripeClient = buildFakeStripeClient();
    const appointmentService = buildDefaultAppointmentService({ stripeClient: fakeStripeClient });

    app = buildApp({ admin: { appointmentService } });
    await app.ready();
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    for (const extraDoctorId of extraDoctorIds) {
      await prisma.doctor.delete({ where: { id: extraDoctorId } }).catch(() => undefined);
    }
    await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  const createAppointmentForDoctor = async (
    targetDoctorId: string,
    overrides: {
      status: 'PENDING' | 'CONFIRMED' | 'PAID' | 'REMINDED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
      dateTime: Date;
      paidAt?: Date | null;
      stripePaymentIntentId?: string;
    },
  ): Promise<string> => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId: targetDoctorId,
        dateTime: overrides.dateTime,
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: overrides.status,
        ...(overrides.paidAt !== undefined ? { paidAt: overrides.paidAt } : {}),
        ...(overrides.stripePaymentIntentId
          ? { stripePaymentIntentId: overrides.stripePaymentIntentId }
          : {}),
      },
    });
    return appointment.id;
  };

  const createAppointment = (overrides: {
    status: 'PENDING' | 'CONFIRMED' | 'PAID' | 'REMINDED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
    dateTime: Date;
    paidAt?: Date | null;
    stripePaymentIntentId?: string;
  }): Promise<string> =>
    createAppointmentForDoctor(doctorId, overrides).then((id) => {
      appointmentIds.push(id);
      return id;
    });

  describe('Autenticación', () => {
    it('rechaza GET /api/admin/appointments sin API key con 401', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/admin/appointments' });
      expect(response.statusCode).toBe(401);
    });

    it('rechaza GET /api/admin/dashboard con una API key incorrecta', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/dashboard',
        headers: { 'x-admin-key': 'clave-incorrecta' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('permite el acceso con la API key correcta', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/appointments',
        headers: ADMIN_HEADER,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('Listado con filtros', () => {
    it('lista citas del doctor incluyendo nombre de paciente y doctor', async () => {
      const appointmentId = await createAppointment({
        status: 'CONFIRMED',
        dateTime: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/appointments?doctorId=${doctorId}&status=CONFIRMED`,
        headers: ADMIN_HEADER,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const found = body.items.find((item: { id: string }) => item.id === appointmentId);
      expect(found).toBeDefined();
      expect(found.patient.name).toBe('Paciente Admin Test');
      expect(found.doctor.name).toBe('Dr. Admin Test');
    });

    it('filtra por rango de fechas dateFrom/dateTo', async () => {
      const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      const appointmentId = await createAppointment({ status: 'CONFIRMED', dateTime: farFuture });

      // Se formatea en hora local (no toISOString, que es UTC) para que
      // coincida con cómo el repositorio interpreta dateFrom/dateTo.
      const formatLocalDate = (date: Date): string =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

      const dateFrom = formatLocalDate(farFuture);
      const dateToDate = new Date(farFuture);
      dateToDate.setDate(dateToDate.getDate() + 1);
      const dateTo = formatLocalDate(dateToDate);

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/appointments?dateFrom=${dateFrom}&dateTo=${dateTo}&doctorId=${doctorId}`,
        headers: ADMIN_HEADER,
      });

      expect(response.statusCode).toBe(200);
      const ids = (response.json().items as Array<{ id: string }>).map((item) => item.id);
      expect(ids).toContain(appointmentId);
    });

    it('pagina con cursor cuando hay más resultados que el límite', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/appointments?doctorId=${doctorId}&limit=1`,
        headers: ADMIN_HEADER,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(1);
      expect(typeof body.nextCursor === 'string' || body.nextCursor === null).toBe(true);
    });
  });

  describe('Detalle de cita', () => {
    it('incluye paciente, doctor y eventos ordenados cronológicamente', async () => {
      const appointmentId = await createAppointment({
        status: 'PAID',
        dateTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        paidAt: new Date(),
        stripePaymentIntentId: `pi_${randomUUID()}`,
      });
      await prisma.appointmentEvent.create({
        data: { appointmentId, type: 'CREATED', payload: {} },
      });
      await prisma.appointmentEvent.create({
        data: { appointmentId, type: 'PAYMENT_RECEIVED', payload: {} },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/appointments/${appointmentId}`,
        headers: ADMIN_HEADER,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.appointment.patient.name).toBe('Paciente Admin Test');
      expect(body.appointment.doctor.name).toBe('Dr. Admin Test');
      const eventTypes = body.appointment.events.map((event: { type: string }) => event.type);
      expect(eventTypes).toEqual(['CREATED', 'PAYMENT_RECEIVED']);
    });

    it('retorna 404 para una cita inexistente', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/appointments/00000000-0000-0000-0000-000000000000',
        headers: ADMIN_HEADER,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('Cancelación desde admin', () => {
    it('cancela una cita PAID con ≥24h de anticipación: refund completo y metadata de admin', async () => {
      const stripePaymentIntentId = `pi_${randomUUID()}`;
      const appointmentId = await createAppointment({
        status: 'PAID',
        dateTime: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        paidAt: new Date(),
        stripePaymentIntentId,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/appointments/${appointmentId}/cancel`,
        headers: ADMIN_HEADER,
        payload: { reason: 'Doctor no disponible' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.appointment.status).toBe('CANCELLED');
      expect(body.refundAmountCents).toBe(CONSULTATION_PRICE_CENTS);
      expect(fakeStripeClient.refunds.create).toHaveBeenCalledWith({
        payment_intent: stripePaymentIntentId,
        amount: CONSULTATION_PRICE_CENTS,
      });

      const event = await prisma.appointmentEvent.findFirst({
        where: { appointmentId, type: 'CANCELLED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(event?.payload).toMatchObject({ cancelledBy: 'ADMIN' });
    });

    it('rechaza cancelar sin el motivo requerido (400 de validación)', async () => {
      const appointmentId = await createAppointment({
        status: 'CONFIRMED',
        dateTime: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000),
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/appointments/${appointmentId}/cancel`,
        headers: ADMIN_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Completar y no-show desde admin', () => {
    it('marca una cita REMINDED como COMPLETED', async () => {
      const appointmentId = await createAppointment({
        status: 'REMINDED',
        dateTime: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/appointments/${appointmentId}/complete`,
        headers: ADMIN_HEADER,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('COMPLETED');
    });

    it('marca una cita REMINDED como NO_SHOW', async () => {
      const appointmentId = await createAppointment({
        status: 'REMINDED',
        dateTime: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000),
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/appointments/${appointmentId}/no-show`,
        headers: ADMIN_HEADER,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('NO_SHOW');
    });

    it('rechaza completar una cita CANCELLED con INVALID_STATE_TRANSITION', async () => {
      const appointmentId = await createAppointment({
        status: 'CANCELLED',
        dateTime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/appointments/${appointmentId}/complete`,
        headers: ADMIN_HEADER,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('Dashboard', () => {
    it('refleja en las stats las citas y el revenue recién creados (comparación por delta)', async () => {
      const before = await app
        .inject({ method: 'GET', url: '/api/admin/dashboard', headers: ADMIN_HEADER })
        .then((res) => res.json());

      // Doctor dedicado a este test: el resto de los tests del archivo ya
      // avanzaron citas a COMPLETED/NO_SHOW para `doctorId`, lo que
      // contaminaría la tasa de no-show si se reutilizara.
      const dashboardDoctor = await prisma.doctor.create({
        data: {
          name: 'Dr. Dashboard Test',
          email: `dashboard-doctor-${randomUUID()}@example.com`,
          specialty: 'Test',
          consultationPriceCents: CONSULTATION_PRICE_CENTS,
        },
      });
      extraDoctorIds.push(dashboardDoctor.id);

      const today = new Date();
      const paidId = await createAppointmentForDoctor(dashboardDoctor.id, {
        status: 'PAID',
        dateTime: today,
        paidAt: today,
      });
      const noShowId = await createAppointmentForDoctor(dashboardDoctor.id, {
        status: 'NO_SHOW',
        dateTime: today,
      });
      const completedId = await createAppointmentForDoctor(dashboardDoctor.id, {
        status: 'COMPLETED',
        dateTime: today,
      });
      appointmentIds.push(paidId, noShowId, completedId);

      const after = await app
        .inject({ method: 'GET', url: '/api/admin/dashboard', headers: ADMIN_HEADER })
        .then((res) => res.json());

      expect(after.appointmentsToday - before.appointmentsToday).toBe(3);
      expect(after.byStatus.PAID - before.byStatus.PAID).toBe(1);
      expect(after.byStatus.NO_SHOW - before.byStatus.NO_SHOW).toBe(1);
      expect(after.byStatus.COMPLETED - before.byStatus.COMPLETED).toBe(1);
      expect(after.revenue.today - before.revenue.today).toBe(CONSULTATION_PRICE_CENTS);

      const doctorRate = after.noShowRateByDoctor.find(
        (entry: { doctorId: string }) => entry.doctorId === dashboardDoctor.id,
      );
      expect(doctorRate).toMatchObject({ noShowCount: 1, completedCount: 1, rate: 0.5 });
    });
  });

  describe('Timeline de eventos', () => {
    it('lista eventos recientes incluyendo contexto de paciente y doctor', async () => {
      const appointmentId = await createAppointment({
        status: 'CONFIRMED',
        dateTime: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      });
      await prisma.appointmentEvent.create({
        data: { appointmentId, type: 'CREATED', payload: { test: 'timeline' } },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/events?hours=24',
        headers: ADMIN_HEADER,
      });

      expect(response.statusCode).toBe(200);
      const events = response.json() as Array<{
        appointmentId: string;
        appointment: { patient: { name: string }; doctor: { name: string } };
      }>;
      const found = events.find((event) => event.appointmentId === appointmentId);
      expect(found?.appointment.patient.name).toBe('Paciente Admin Test');
      expect(found?.appointment.doctor.name).toBe('Dr. Admin Test');
    });
  });
});
