import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { AppError } from '../../src/lib/app-error.js';
import type { DoctorsClient } from '../../src/clients/doctors-client.js';
import type { PaymentsClient } from '../../src/clients/payments-client.js';

const CONSULTATION_PRICE_CENTS = 70_000;

// Bloques de 30 minutos a partir de las 09:00 del día siguiente, dentro de
// "disponibilidad" simulada del doctor fake (09:00-12:00).
const buildSlotDateTime = (hour: number, minute: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const buildFakeDoctorsClient = (doctorId: string): DoctorsClient => ({
  getDoctor: vi.fn().mockImplementation(async (id: string) =>
    id === doctorId ? { id: doctorId, consultationPriceCents: CONSULTATION_PRICE_CENTS } : null,
  ),
  getAvailableSlots: vi.fn().mockImplementation(async () => {
    const slots: string[] = [];
    for (let minutes = 9 * 60; minutes < 12 * 60; minutes += 30) {
      slots.push(buildSlotDateTime(Math.floor(minutes / 60), minutes % 60).toISOString());
    }
    return slots;
  }),
});

const buildFakePaymentsClient = (): PaymentsClient => ({
  createCustomer: vi.fn(),
  createPaymentIntent: vi
    .fn()
    .mockResolvedValue({ id: `pi_${randomUUID()}`, clientSecret: 'secret_123' }),
  cancelPaymentIntent: vi.fn().mockResolvedValue(undefined),
  createRefund: vi.fn().mockResolvedValue({ id: `re_${randomUUID()}` }),
});

describe('Appointments (integración con DB real, Doctors/Payments mockeados)', () => {
  let app: FastifyInstance;
  const doctorId = randomUUID();
  let patientId: string;
  let fakePaymentsClient: PaymentsClient;
  const slotDateTime = buildSlotDateTime(9, 0);
  const createdAppointmentIds: string[] = [];

  beforeAll(async () => {
    const patient = await prisma.patient.create({
      data: {
        email: `apt-patient-${randomUUID()}@example.com`,
        name: 'Paciente Test',
        phone: '+54 9 11 5555-2222',
        stripeCustomerId: 'cus_test_123',
      },
    });
    patientId = patient.id;

    fakePaymentsClient = buildFakePaymentsClient();
    app = await buildApp({
      appointments: {
        doctorsClient: buildFakeDoctorsClient(doctorId),
        paymentsClient: fakePaymentsClient,
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
        enqueueReminder: vi.fn().mockResolvedValue(undefined),
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    if (createdAppointmentIds.length > 0) {
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
    }
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  it('crea una cita con PaymentIntent, queda CONFIRMED y publica AppointmentCreated', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      payload: { patientId, doctorId, dateTime: slotDateTime.toISOString() },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.appointment.status).toBe('CONFIRMED');
    expect(body.appointment.amountCents).toBe(CONSULTATION_PRICE_CENTS);
    expect(body.clientSecret).toBe('secret_123');
    expect(fakePaymentsClient.createPaymentIntent).toHaveBeenCalledWith(
      body.appointment.id,
      CONSULTATION_PRICE_CENTS,
      'cus_test_123',
    );
    createdAppointmentIds.push(body.appointment.id);

    const events = await prisma.outboxEvent.findMany({ where: { type: 'AppointmentCreated' } });
    const match = events.find(
      (event) => (event.payload as { appointmentId?: string }).appointmentId === body.appointment.id,
    );
    expect(match).toBeDefined();
  });

  it('rechaza una segunda cita en el mismo horario ya ocupado (conflicto propio de Appointments)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      payload: { patientId, doctorId, dateTime: slotDateTime.toISOString() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('rechaza un horario fuera de la disponibilidad informada por Doctors', async () => {
    const outsideAvailability = new Date(slotDateTime);
    outsideAvailability.setHours(20, 0, 0, 0);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      payload: { patientId, doctorId, dateTime: outsideAvailability.toISOString() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('rechaza una fecha en el pasado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      payload: { patientId, doctorId, dateTime: '2020-01-01T09:00:00.000Z' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('PAST_DATE');
  });

  it('rechaza un doctor inexistente con 404 (query síncrona a Doctors)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      payload: {
        patientId,
        doctorId: randomUUID(),
        dateTime: buildSlotDateTime(10, 0).toISOString(),
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('DOCTOR_NOT_FOUND');
  });

  it('borra la cita PENDING (no la deja huérfana) si Payments falla al crear el PaymentIntent', async () => {
    const failingPaymentsClient: PaymentsClient = {
      ...buildFakePaymentsClient(),
      createPaymentIntent: vi
        .fn()
        .mockRejectedValue(new AppError(502, 'PAYMENTS_UNAVAILABLE', 'Servicio de pago no disponible')),
    };
    const failingApp = await buildApp({
      appointments: {
        doctorsClient: buildFakeDoctorsClient(doctorId),
        paymentsClient: failingPaymentsClient,
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
        enqueueReminder: vi.fn().mockResolvedValue(undefined),
      },
    });
    await failingApp.ready();

    const dateTime = buildSlotDateTime(10, 30);
    const response = await failingApp.inject({
      method: 'POST',
      url: '/v1/appointments',
      payload: { patientId, doctorId, dateTime: dateTime.toISOString() },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('PAYMENTS_UNAVAILABLE');

    const orphaned = await prisma.appointment.findFirst({ where: { doctorId, dateTime } });
    expect(orphaned).toBeNull();

    await failingApp.close();
  });

  it('detalle de la cita incluye sus eventos (CREATED y STATUS_CHANGED)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/appointments/${createdAppointmentIds[0]}`,
    });

    expect(response.statusCode).toBe(200);
    const eventTypes = (response.json().events as Array<{ type: string }>).map((event) => event.type);
    expect(eventTypes).toEqual(['CREATED', 'STATUS_CHANGED']);
  });

  it('lista citas filtrando por doctorId y status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/appointments?doctorId=${doctorId}&status=CONFIRMED`,
    });

    expect(response.statusCode).toBe(200);
    const ids = (response.json().items as Array<{ id: string }>).map((appointment) => appointment.id);
    expect(ids).toContain(createdAppointmentIds[0]);
  });

  it('lista citas con paginación por cursor: la página trae nextCursor cuando hay más resultados', async () => {
    const baseDateTime = buildSlotDateTime(8, 0);
    const pageDoctorId = randomUUID();
    for (let i = 0; i < 3; i += 1) {
      const appointment = await prisma.appointment.create({
        data: {
          patientId,
          doctorId: pageDoctorId,
          dateTime: new Date(baseDateTime.getTime() + i * 60_000),
          durationMinutes: 30,
          amountCents: CONSULTATION_PRICE_CENTS,
          status: 'PENDING',
        },
      });
      createdAppointmentIds.push(appointment.id);
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: `/v1/appointments?doctorId=${pageDoctorId}`,
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(firstBody.items).toHaveLength(3);
    expect(firstBody.nextCursor).toBeNull();
    expect(firstBody.items[0]).toHaveProperty('patient');
  });

  it('cancela una cita CONFIRMED sin refund, cancelando el PaymentIntent', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${createdAppointmentIds[0]}/cancel`,
      payload: { reason: 'Ya no puedo asistir' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.refundAmountCents).toBe(0);
    expect(body.appointment.status).toBe('CANCELLED');
    expect(fakePaymentsClient.cancelPaymentIntent).toHaveBeenCalled();
  });

  it('rechaza cancelar una cita ya CANCELLED (estado final) con INVALID_STATE_TRANSITION', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${createdAppointmentIds[0]}/cancel`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('cancela una cita PAID con ≥24h de anticipación: refund completo', async () => {
    const farDateTime = buildSlotDateTime(11, 0);
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
      url: `/v1/appointments/${appointment.id}/cancel`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.refundAmountCents).toBe(CONSULTATION_PRICE_CENTS);
    expect(fakePaymentsClient.createRefund).toHaveBeenCalledWith(
      appointment.stripePaymentIntentId,
      CONSULTATION_PRICE_CENTS,
      appointment.id,
    );
  });

  it('registra cancelledBy: ADMIN cuando el gateway reenvía el rol del JWT', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: buildSlotDateTime(11, 0),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'PENDING',
      },
    });
    createdAppointmentIds.push(appointment.id);

    await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointment.id}/cancel`,
      headers: { 'x-internal-user-role': 'ADMIN' },
      payload: {},
    });

    const detail = await app.inject({ method: 'GET', url: `/v1/appointments/${appointment.id}` });
    const statusChangedEvent = (detail.json().events as Array<{ type: string; payload: { cancelledBy?: string } }>)
      .find((event) => event.type === 'CANCELLED');
    expect(statusChangedEvent?.payload.cancelledBy).toBe('ADMIN');
  });

  it('registra cancelledBy: PATIENT cuando no hay rol reenviado por el gateway', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: buildSlotDateTime(11, 30),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'PENDING',
      },
    });
    createdAppointmentIds.push(appointment.id);

    await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointment.id}/cancel`,
      payload: {},
    });

    const detail = await app.inject({ method: 'GET', url: `/v1/appointments/${appointment.id}` });
    const statusChangedEvent = (detail.json().events as Array<{ type: string; payload: { cancelledBy?: string } }>)
      .find((event) => event.type === 'CANCELLED');
    expect(statusChangedEvent?.payload.cancelledBy).toBe('PATIENT');
  });

  it('cancela una cita PAID con <24h de anticipación: refund parcial del 50%', async () => {
    const soonDateTime = new Date(Date.now() + 60 * 60 * 1000);

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
      url: `/v1/appointments/${appointment.id}/cancel`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().refundAmountCents).toBe(Math.round(CONSULTATION_PRICE_CENTS * 0.5));
  });

  it('no permite cancelar una cita COMPLETED', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: buildSlotDateTime(11, 30),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'COMPLETED',
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointment.id}/cancel`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('marca una cita REMINDED como completada', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: buildSlotDateTime(9, 30),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'REMINDED',
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointment.id}/complete`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('COMPLETED');
  });

  it('marca una cita REMINDED como no-show', async () => {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: buildSlotDateTime(10, 0),
        durationMinutes: 30,
        amountCents: CONSULTATION_PRICE_CENTS,
        status: 'REMINDED',
      },
    });
    createdAppointmentIds.push(appointment.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointment.id}/no-show`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('NO_SHOW');
  });

  it('conflicto de slot: de dos reservas concurrentes para el mismo horario, solo una gana', async () => {
    const concurrentDateTime = buildSlotDateTime(9, 0);

    const concurrentApp1 = await buildApp({
      appointments: {
        doctorsClient: buildFakeDoctorsClient(doctorId),
        paymentsClient: buildFakePaymentsClient(),
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
        enqueueReminder: vi.fn().mockResolvedValue(undefined),
      },
    });
    const concurrentApp2 = await buildApp({
      appointments: {
        doctorsClient: buildFakeDoctorsClient(doctorId),
        paymentsClient: buildFakePaymentsClient(),
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
        enqueueReminder: vi.fn().mockResolvedValue(undefined),
      },
    });
    await Promise.all([concurrentApp1.ready(), concurrentApp2.ready()]);

    const [responseA, responseB] = await Promise.all([
      concurrentApp1.inject({
        method: 'POST',
        url: '/v1/appointments',
        payload: { patientId, doctorId, dateTime: concurrentDateTime.toISOString() },
      }),
      concurrentApp2.inject({
        method: 'POST',
        url: '/v1/appointments',
        payload: { patientId, doctorId, dateTime: concurrentDateTime.toISOString() },
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
