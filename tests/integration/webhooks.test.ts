import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import { stripe } from '../../src/config/stripe.js';

const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_webhook_tests';

const buildStripeEvent = (type: string, object: Record<string, unknown>): Record<string, unknown> => ({
  id: `evt_${randomUUID()}`,
  type,
  data: { object },
});

const signPayload = (payload: Record<string, unknown>): { rawBody: string; signature: string } => {
  const rawBody = JSON.stringify(payload);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: TEST_WEBHOOK_SECRET,
  });
  return { rawBody, signature };
};

describe('POST /api/webhooks/stripe (integración con DB real)', () => {
  let app: FastifyInstance;
  let doctorId: string;
  let patientId: string;
  let enqueueEmail: ReturnType<typeof vi.fn>;
  let enqueueReminder: ReturnType<typeof vi.fn>;
  const appointmentIds: string[] = [];

  beforeAll(async () => {
    const doctor = await prisma.doctor.create({
      data: {
        name: 'Dr. Webhooks Test',
        email: `webhook-doctor-${randomUUID()}@example.com`,
        specialty: 'Test',
      },
    });
    doctorId = doctor.id;

    const patient = await prisma.patient.create({
      data: {
        email: `webhook-patient-${randomUUID()}@example.com`,
        name: 'Paciente Webhooks',
        phone: '+54 9 11 5555-4444',
      },
    });
    patientId = patient.id;
  });

  beforeEach(() => {
    enqueueEmail = vi.fn().mockResolvedValue(undefined);
    enqueueReminder = vi.fn().mockResolvedValue(undefined);
    app = buildApp({
      webhooks: { webhookSecret: TEST_WEBHOOK_SECRET, enqueueEmail, enqueueReminder },
    });
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.$disconnect();
    redis.disconnect();
  });

  const createConfirmedAppointment = async (dateTime: Date): Promise<{ id: string; stripePaymentIntentId: string }> => {
    const stripePaymentIntentId = `pi_${randomUUID()}`;
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime,
        durationMinutes: 30,
        amountCents: 50_000,
        status: 'CONFIRMED',
        stripePaymentIntentId,
        confirmedAt: new Date(),
      },
    });
    appointmentIds.push(appointment.id);
    return { id: appointment.id, stripePaymentIntentId };
  };

  it('payment_intent.succeeded: la cita pasa a PAID y se encolan email y reminder', async () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const { id: appointmentId, stripePaymentIntentId } = await createConfirmedAppointment(futureDate);

    const event = buildStripeEvent('payment_intent.succeeded', {
      id: stripePaymentIntentId,
      object: 'payment_intent',
    });
    const { rawBody, signature } = signPayload(event);

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe('PAID');
    expect(appointment?.paidAt).not.toBeNull();

    expect(enqueueEmail).toHaveBeenCalledWith('confirmation', appointmentId, expect.any(String));
    expect(enqueueReminder).toHaveBeenCalledWith(appointmentId, futureDate, expect.any(String));

    const webhookEvent = await prisma.webhookEvent.findUnique({
      where: { stripeEventId: event.id as string },
    });
    expect(webhookEvent?.processedAt).not.toBeNull();
  });

  it('idempotencia: el MISMO webhook entregado 2 veces deja la cita en PAID y solo encola el email una vez', async () => {
    const futureDate = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const { id: appointmentId, stripePaymentIntentId } = await createConfirmedAppointment(futureDate);

    const event = buildStripeEvent('payment_intent.succeeded', {
      id: stripePaymentIntentId,
      object: 'payment_intent',
    });
    const { rawBody, signature } = signPayload(event);

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe('PAID');

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    expect(enqueueReminder).toHaveBeenCalledTimes(1);

    const events = await prisma.appointmentEvent.findMany({ where: { appointmentId } });
    const statusChangedEvents = events.filter((appointmentEvent) => appointmentEvent.type === 'PAYMENT_RECEIVED');
    expect(statusChangedEvents).toHaveLength(1);
  });

  it('rechaza con 401 un webhook con firma inválida', async () => {
    const event = buildStripeEvent('payment_intent.succeeded', { id: 'pi_does_not_matter' });
    const rawBody = JSON.stringify(event);

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=firma-invalida' },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_SIGNATURE');
  });

  it('webhook para una cita inexistente: responde 200 sin reventar', async () => {
    const event = buildStripeEvent('payment_intent.succeeded', {
      id: `pi_${randomUUID()}`,
      object: 'payment_intent',
    });
    const { rawBody, signature } = signPayload(event);

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);

    const webhookEvent = await prisma.webhookEvent.findUnique({
      where: { stripeEventId: event.id as string },
    });
    expect(webhookEvent?.processedAt).not.toBeNull();
  });

  it('payment_intent.payment_failed: no cambia el estado, registra el evento y encola la notificación', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const { id: appointmentId, stripePaymentIntentId } = await createConfirmedAppointment(futureDate);

    const event = buildStripeEvent('payment_intent.payment_failed', {
      id: stripePaymentIntentId,
      object: 'payment_intent',
      last_payment_error: { message: 'Tarjeta rechazada' },
    });
    const { rawBody, signature } = signPayload(event);

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe('CONFIRMED');

    const events = await prisma.appointmentEvent.findMany({ where: { appointmentId, type: 'PAYMENT_FAILED' } });
    expect(events).toHaveLength(1);

    expect(enqueueEmail).toHaveBeenCalledWith('payment-failed', appointmentId, expect.any(String));
  });

  it('estado inesperado en DB (cita ya PAID): loguea el error, no revienta y responde 200', async () => {
    const futureDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const { id: appointmentId, stripePaymentIntentId } = await createConfirmedAppointment(futureDate);

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const event = buildStripeEvent('payment_intent.succeeded', {
      id: stripePaymentIntentId,
      object: 'payment_intent',
    });
    const { rawBody, signature } = signPayload(event);

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);

    const webhookEvent = await prisma.webhookEvent.findUnique({
      where: { stripeEventId: event.id as string },
    });
    expect(webhookEvent?.processedAt).not.toBeNull();

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe('PAID');
  });
});
