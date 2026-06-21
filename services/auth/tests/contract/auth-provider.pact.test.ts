import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Verifier } from '@pact-foundation/pact';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';

const PACT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'pacts',
  'gateway-auth.json',
);

// Verificación del lado del provider (PLAN.md Fase 4, punto 3b): el JWKS
// real de Auth (par de llaves generado en memoria al iniciar, ver
// src/lib/keys.ts) nunca va a tener el mismo n/e que generó el consumer
// test del gateway — por eso esos campos viajan como `like()` en el pact
// (solo valida shape/tipo). Lo que sí se verifica exacto es kty/alg/use.
describe('Pact provider verification: Auth (JWKS)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp();
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

  it('cumple el contrato definido por el gateway', async () => {
    const verifier = new Verifier({
      provider: 'auth',
      providerBaseUrl: baseUrl,
      pactUrls: [PACT_FILE],
      stateHandlers: {
        'Auth tiene un par de llaves RS256 activo': async () => undefined,
      },
    });

    await verifier.verifyProvider();
  });
});
