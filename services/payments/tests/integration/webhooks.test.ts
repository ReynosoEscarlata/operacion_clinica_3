import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
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

describe('POST /v1/webhooks/stripe (integración con DB real)', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('rechaza un webhook sin firma', async () => {
    app = await buildApp({ payments: { webhookSecret: TEST_WEBHOOK_SECRET } });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      payload: { id: 'evt_1' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_SIGNATURE');
  });

  it('rechaza un webhook con firma inválida', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 't=1,v1=firma-invalida' },
      payload: { id: 'evt_2' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_SIGNATURE');
  });

  it('payment_intent.succeeded: publica PaymentSucceeded en el Outbox con el appointmentId de metadata', async () => {
    const appointmentId = randomUUID();
    const event = buildStripeEvent('payment_intent.succeeded', {
      id: 'pi_test_1',
      amount: 50_000,
      metadata: { appointmentId },
    });
    const { rawBody, signature } = signPayload(event);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);

    const events = await prisma.outboxEvent.findMany({ where: { type: 'PaymentSucceeded' } });
    const match = events.find((e) => (e.payload as { appointmentId?: string }).appointmentId === appointmentId);
    expect(match).toBeDefined();
    expect((match?.payload as { paymentIntentId?: string }).paymentIntentId).toBe('pi_test_1');

    const webhookEvent = await prisma.webhookEvent.findUnique({
      where: { stripeEventId: event.id as string },
    });
    expect(webhookEvent?.processedAt).not.toBeNull();
  });

  it('es idempotente: el mismo stripeEventId no se procesa dos veces', async () => {
    const appointmentId = randomUUID();
    const event = buildStripeEvent('payment_intent.succeeded', {
      id: 'pi_test_2',
      amount: 30_000,
      metadata: { appointmentId },
    });
    const { rawBody, signature } = signPayload(event);

    await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      payload: rawBody,
    });
    await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      payload: rawBody,
    });

    const events = await prisma.outboxEvent.findMany({ where: { type: 'PaymentSucceeded' } });
    const matches = events.filter(
      (e) => (e.payload as { appointmentId?: string }).appointmentId === appointmentId,
    );
    expect(matches).toHaveLength(1);
  });

  it('payment_intent.payment_failed: publica PaymentFailed en el Outbox', async () => {
    const appointmentId = randomUUID();
    const event = buildStripeEvent('payment_intent.payment_failed', {
      id: 'pi_test_3',
      metadata: { appointmentId },
      last_payment_error: { message: 'Tarjeta rechazada' },
    });
    const { rawBody, signature } = signPayload(event);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);

    const events = await prisma.outboxEvent.findMany({ where: { type: 'PaymentFailed' } });
    const match = events.find((e) => (e.payload as { appointmentId?: string }).appointmentId === appointmentId);
    expect(match).toBeDefined();
    expect((match?.payload as { reason?: string }).reason).toBe('Tarjeta rechazada');
  });

  it('ignora sin error un PaymentIntent sin appointmentId en metadata', async () => {
    const event = buildStripeEvent('payment_intent.succeeded', { id: 'pi_test_4', metadata: {} });
    const { rawBody, signature } = signPayload(event);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
  });

  it('ignora sin error un tipo de evento sin manejador específico', async () => {
    const event = buildStripeEvent('charge.refunded', { id: 'ch_test_1' });
    const { rawBody, signature } = signPayload(event);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
  });
});
