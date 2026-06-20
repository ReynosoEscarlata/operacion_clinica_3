import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import type { StripeAppointmentsClient } from '../../src/modules/appointments/appointments.service.js';

const CONSULTATION_PRICE_CENTS = 70_000;

const getNextWeekdayDate = (targetDayOfWeek: number, hour: number, minute: number): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() !== targetDayOfWeek);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const buildFakeStripeClient = (): StripeAppointmentsClient => ({
  paymentIntents: {
    create: vi.fn().mockResolvedValue({ id: `pi_${randomUUID()}`, client_secret: 'secret_123' }),
    cancel: vi.fn().mockResolvedValue({}),
  },
  refunds: {
    create: vi.fn().mockResolvedValue({ id: `re_${randomUUID()}` }),
  },
});

describe('Appointments (integración con DB real, Stripe mockeado)', () => {
  let app: FastifyInstance;
  let doctorId: string;
  let patientId: string;
  let patientId2: string;
  let fakeStripeClient: StripeAppointmentsClient;
  const slotDateTime = getNextWeekdayDate(1, 9, 0); // próximo lunes 09:00
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    const doctor = await prisma.doctor.create({
      data: {
        name: 'Dr. Appointments Test',
        email: `apt-doctor-${randomUUID()}@example.com`,
        specialty: 'Test',
        consultationPriceCents: CONSULTATION_PRICE_CENTS,
      },
    });
    doctorId = doctor.id;

    await prisma.availability.create({
      data: { doctorId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
    });

    const patient = await prisma.patient.create({
      data: {
        email: `apt-patient-${randomUUID()}@example.com`,
        name: 'Paciente Test',
        phone: '+54 9 11 5555-2222',
        stripeCustomerId: 'cus_test_123',
      },
    });
    patientId = patient.id;

    const patient2 = await prisma.patient.create({
      data: {
        email: `apt-patient2-${randomUUID()}@example.com`,
        name: 'Paciente Test 2',
        phone: '+54 9 11 5555-3333',
      },
    });
    patientId2 = patient2.id;

    fakeStripeClient = buildFakeStripeClient();
    app = buildApp({
      appointments: {
        stripeClient: fakeStripeClient,
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    if (createdAppointmentIds.length > 0) {
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    }
    await prisma.appointment.deleteMany({ where: { doctorId } });
    await prisma.availability.deleteMany({ where: { doctorId } });
    await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId2 } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('crea una cita con PaymentIntent y queda CONFIRMED', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      payload: { patientId, doctorId, dateTime: slotDateTime.toISOString() },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.appointment.status).toBe('CONFIRMED');
    expect(body.appointment.amountCents).toBe(CONSULTATION_PRICE_CENTS);
    expect(body.clientSecret).toBe('secret_123');
    expect(fakeStripeClient.paymentIntents.create).toHaveBeenCalledWith({
      amount: CONSULTATION_PRICE_CENTS,
      currency: 'mxn',
      customer: 'cus_test_123',
      metadata: { appointmentId: body.appointment.id },
      automatic_payment_methods: { enabled: true },
    });

    createdAppointmentIds.push(body.appointment.id);
  });

  it('rechaza una segunda cita en el mismo horario ya ocupado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      payload: { patientId: patientId2, doctorId, dateTime: slotDateTime.toISOString() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('rechaza un horario fuera de la disponibilidad del doctor', async () => {
    const outsideAvailability = new Date(slotDateTime);
    outsideAvailability.setHours(20, 0, 0, 0);

    const response = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      payload: { patientId: patientId2, doctorId, dateTime: outsideAvailability.toISOString() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('rechaza una fecha en el pasado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      payload: { patientId: patientId2, doctorId, dateTime: '2020-01-01T09:00:00.000Z' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('PAST_DATE');
  });

  it('rechaza un doctor inexistente con 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      payload: {
        patientId: patientId2,
        doctorId: '00000000-0000-0000-0000-000000000000',
        dateTime: getNextWeekdayDate(1, 10, 0).toISOString(),
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('DOCTOR_NOT_FOUND');
  });

  it('borra la cita PENDING (no la deja huérfana) si Stripe falla al crear el PaymentIntent', async () => {
    const failingStripeClient: StripeAppointmentsClient = {
      paymentIntents: {
        create: vi.fn().mockRejectedValue(new Error('stripe down')),
        cancel: vi.fn(),
      },
      refunds: { create: vi.fn() },
    };
    const failingApp = buildApp({
      appointments: {
        stripeClient: failingStripeClient,
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
      },
    });
    await failingApp.ready();

    const dateTime = getNextWeekdayDate(1, 10, 30);
    const response = await failingApp.inject({
      method: 'POST',
      url: '/api/appointments',
      payload: { patientId: patientId2, doctorId, dateTime: dateTime.toISOString() },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('STRIPE_UNAVAILABLE');

    const orphaned = await prisma.appointment.findFirst({ where: { doctorId, dateTime } });
    expect(orphaned).toBeNull();

    await failingApp.close();
  });

  it('detalle de la cita incluye sus eventos (CREATED y STATUS_CHANGED)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/appointments/${createdAppointmentIds[0]}`,
    });

    expect(response.statusCode).toBe(200);
    const eventTypes = (response.json().events as Array<{ type: string }>).map((event) => event.type);
    expect(eventTypes).toEqual(['CREATED', 'STATUS_CHANGED']);
  });

  it('lista citas filtrando por doctorId y status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/appointments?doctorId=${doctorId}&status=CONFIRMED`,
    });

    expect(response.statusCode).toBe(200);
    const ids = (response.json() as Array<{ id: string }>).map((appointment) => appointment.id);
    expect(ids).toContain(createdAppointmentIds[0]);
  });

  it('cancela una cita CONFIRMED sin refund, cancelando el PaymentIntent', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/appointments/${createdAppointmentIds[0]}/cancel`,
      payload: { reason: 'Ya no puedo asistir' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.refundAmountCents).toBe(0);
    expect(body.appointment.status).toBe('CANCELLED');
    expect(fakeStripeClient.paymentIntents.cancel).toHaveBeenCalled();
  });

  it('rechaza cancelar una cita ya CANCELLED (estado final) con INVALID_STATE_TRANSITION', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/appointments/${createdAppointmentIds[0]}/cancel`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('cancela una cita PAID con ≥24h de anticipación: refund completo', async () => {
    const farDateTime = getNextWeekdayDate(1, 11, 0);
    farDateTime.setDate(farDateTime.getDate() + 14);

    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: farDateTime,
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'PAID',
        stripePaymentIntentId: `pi_${randomUUID()}`,
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/appointments/${appointment.id}/cancel`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.refundAmountCents).toBe(CONSULTATION_PRICE_CENTS);
    expect(fakeStripeClient.refunds.create).toHaveBeenCalledWith({
      payment_intent: appointment.stripePaymentIntentId,
      amount: CONSULTATION_PRICE_CENTS,
    });
  });

  it('cancela una cita PAID con <24h de anticipación: refund parcial del 50%', async () => {
    const soonDateTime = new Date(Date.now() + 60 * 60 * 1000); // en 1 hora

    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: soonDateTime,
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'PAID',
        stripePaymentIntentId: `pi_${randomUUID()}`,
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/appointments/${appointment.id}/cancel`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.refundAmountCents).toBe(Math.round(CONSULTATION_PRICE_CENTS * 0.5));
  });

  it('no permite cancelar una cita COMPLETED', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: getNextWeekdayDate(1, 11, 30),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'COMPLETED',
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/appointments/${appointment.id}/cancel`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rechaza marcar como completada sin credenciales de admin', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: getNextWeekdayDate(1, 9, 30),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'REMINDED',
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/appointments/${appointment.id}/complete`,
    });

    expect(response.statusCode).toBe(401);
  });

  it('permite marcar como completada con credenciales de admin válidas', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: getNextWeekdayDate(1, 10, 0),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'REMINDED',
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/appointments/${appointment.id}/complete`,
      headers: { 'x-admin-key': process.env.ADMIN_API_KEY ?? '' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('COMPLETED');
  });

  it('permite marcar como no-show con credenciales de admin válidas', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: getNextWeekdayDate(1, 11, 0),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'REMINDED',
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/appointments/${appointment.id}/no-show`,
      headers: { 'x-admin-key': process.env.ADMIN_API_KEY ?? '' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('NO_SHOW');
  });

  it('conflicto de slot: de dos reservas concurrentes para el mismo horario, solo una gana', async () => {
    // Reutiliza el slot 09:00, que quedó CANCELLED en el primer test: confirma
    // además que un slot cancelado puede volver a reservarse sin problema.
    const concurrentDateTime = getNextWeekdayDate(1, 9, 0);

    const concurrentApp1 = buildApp({
      appointments: { stripeClient: buildFakeStripeClient(), enqueueExpiration: vi.fn().mockResolvedValue(undefined) },
    });
    const concurrentApp2 = buildApp({
      appointments: { stripeClient: buildFakeStripeClient(), enqueueExpiration: vi.fn().mockResolvedValue(undefined) },
    });
    await Promise.all([concurrentApp1.ready(), concurrentApp2.ready()]);

    const [responseA, responseB] = await Promise.all([
      concurrentApp1.inject({
        method: 'POST',
        url: '/api/appointments',
        payload: { patientId, doctorId, dateTime: concurrentDateTime.toISOString() },
      }),
      concurrentApp2.inject({
        method: 'POST',
        url: '/api/appointments',
        payload: { patientId: patientId2, doctorId, dateTime: concurrentDateTime.toISOString() },
      }),
    ]);

    const statusCodes = [responseA.statusCode, responseB.statusCode].sort();
    expect(statusCodes).toEqual([201, 409]);

    const winner = responseA.statusCode === 201 ? responseA : responseB;
    createdAppointmentIds.push(winner.json().appointment.id);

    const activeAppointments = await prisma.appointment.findMany({
      where: { doctorId, dateTime: concurrentDateTime, status: { not: 'CANCELLED' } },
    });
    expect(activeAppointments).toHaveLength(1);

    await concurrentApp1.close();
    await concurrentApp2.close();
  });
});
