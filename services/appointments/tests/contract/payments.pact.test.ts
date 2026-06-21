import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';

import { buildHttpPaymentsClient } from '../../src/clients/payments-client.js';

const { like, uuid } = MatchersV3;

// Contract entre Appointments (consumer) y Payments (provider) — PLAN.md
// Fase 4, punto 3b. Mismo patrón sin Pact Broker que doctors.pact.test.ts.
// appointmentId tiene que ser un UUID real (no "apt-1"): Pact reproduce el
// valor literal del ejemplo contra la app real del provider al verificar,
// y CreatePaymentIntentBody exige format:'uuid' — usar un valor inventado
// hacía fallar la verificación del lado de Payments por una razón que no
// tenía nada que ver con el contrato real.
const APPOINTMENT_ID = '44444444-4444-4444-4444-444444444444';

const PACTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'pacts');

describe('Pact: Appointments (consumer) ↔ Payments (provider)', () => {
  const pact = new PactV3({
    consumer: 'appointments',
    provider: 'payments',
    dir: PACTS_DIR,
  });

  it('POST /v1/customers crea un customer de Stripe', async () => {
    pact
      .given('Stripe acepta crear customers')
      .uponReceiving('una creación de customer')
      .withRequest({
        method: 'POST',
        path: '/v1/customers',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'paciente@example.com', name: 'Paciente Test' },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: { id: like('cus_123') },
      });

    await pact.executeTest(async (mockServer) => {
      const client = buildHttpPaymentsClient(mockServer.url);
      const result = await client.createCustomer('paciente@example.com', 'Paciente Test');
      expect(result.id).toBeTruthy();
    });
  });

  it('POST /v1/payment-intents crea un PaymentIntent con clientSecret', async () => {
    pact
      .given('Stripe acepta crear payment intents')
      .uponReceiving('una creación de payment intent')
      .withRequest({
        method: 'POST',
        path: '/v1/payment-intents',
        headers: { 'Content-Type': 'application/json' },
        body: {
          appointmentId: uuid(APPOINTMENT_ID),
          amountCents: like(50_000),
          patientStripeCustomerId: like('cus_123'),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: { id: like('pi_123'), clientSecret: like('secret_123') },
      });

    await pact.executeTest(async (mockServer) => {
      const client = buildHttpPaymentsClient(mockServer.url);
      const result = await client.createPaymentIntent(APPOINTMENT_ID, 50_000, 'cus_123');
      expect(result.id).toBeTruthy();
      expect(result.clientSecret).toBeTruthy();
    });
  });

  it('POST /v1/payment-intents/:id/cancel cancela un PaymentIntent', async () => {
    pact
      .given('el payment intent existe y se puede cancelar')
      .uponReceiving('una cancelación de payment intent')
      .withRequest({ method: 'POST', path: '/v1/payment-intents/pi_123/cancel' })
      .willRespondWith({ status: 200 });

    await pact.executeTest(async (mockServer) => {
      const client = buildHttpPaymentsClient(mockServer.url);
      await expect(client.cancelPaymentIntent('pi_123')).resolves.not.toThrow();
    });
  });

  it('POST /v1/refunds crea un refund', async () => {
    pact
      .given('el payment intent existe y se puede reembolsar')
      .uponReceiving('una creación de refund')
      .withRequest({
        method: 'POST',
        path: '/v1/refunds',
        headers: { 'Content-Type': 'application/json' },
        body: { paymentIntentId: like('pi_123'), amountCents: like(25_000), appointmentId: uuid(APPOINTMENT_ID) },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: { id: like('re_123') },
      });

    await pact.executeTest(async (mockServer) => {
      const client = buildHttpPaymentsClient(mockServer.url);
      const result = await client.createRefund('pi_123', 25_000, APPOINTMENT_ID);
      expect(result.id).toBeTruthy();
    });
  });
});
