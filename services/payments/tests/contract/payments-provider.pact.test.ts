import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Verifier } from '@pact-foundation/pact';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import type { StripePaymentsClient } from '../../src/modules/payments/payments.service.js';

const PACT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'pacts',
  'appointments-payments.json',
);

// Mismo patrón que en services/payments/tests/unit/payments.service.test.ts:
// Stripe se mockea siempre en tests (no hay credenciales reales en CI) —
// la verificación de Pact no es la excepción, lo que se está verificando
// es que Payments expone el contrato HTTP que Appointments espera, no que
// Stripe funcione.
const buildFakeStripeClient = (): StripePaymentsClient => ({
  customers: { create: vi.fn().mockResolvedValue({ id: 'cus_123' }) },
  paymentIntents: {
    create: vi.fn().mockResolvedValue({ id: 'pi_123', client_secret: 'secret_123' }),
    cancel: vi.fn().mockResolvedValue({}),
  },
  refunds: { create: vi.fn().mockResolvedValue({ id: 're_123' }) },
});

describe('Pact provider verification: Payments', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp({ payments: { stripeClient: buildFakeStripeClient() } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('No se pudo obtener el puerto del servidor de prueba');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('cumple el contrato definido por Appointments', async () => {
    const verifier = new Verifier({
      provider: 'payments',
      providerBaseUrl: baseUrl,
      pactUrls: [PACT_FILE],
      // El tipo de stateHandlers del Verifier exige una función simple,
      // no el {setup,teardown} de la Proxy API — ver el equivalente en
      // doctors-provider.pact.test.ts. Acá no hay nada que sembrar (Stripe
      // está mockeado), los estados son solo documentación del contrato.
      stateHandlers: {
        'Stripe acepta crear customers': async () => undefined,
        'Stripe acepta crear payment intents': async () => undefined,
        'el payment intent existe y se puede cancelar': async () => undefined,
        'el payment intent existe y se puede reembolsar': async () => undefined,
      },
    });

    await verifier.verifyProvider();
  });
});
