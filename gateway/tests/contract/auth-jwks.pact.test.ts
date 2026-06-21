import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import { createRemoteJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

const { like } = MatchersV3;

// Contract entre Gateway (consumer) y Auth (provider) — PLAN.md Fase 4,
// punto 3b. El gateway es, en general, un proxy "tonto" que no parsea
// cuerpos de los servicios que reenvía — la única excepción real es JWKS:
// verify-jwt.ts SÍ consume y parsea esta respuesta (createRemoteJWKSet +
// jwtVerify), por eso es la única relación gateway↔servicio que tiene
// sentido modelar como contrato (no hay nada que afirmar de un proxy ciego).
const PACTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pacts');

describe('Pact: Gateway (consumer) ↔ Auth (provider) — JWKS', () => {
  const pact = new PactV3({
    consumer: 'gateway',
    provider: 'auth',
    dir: PACTS_DIR,
  });

  it('GET /v1/auth/.well-known/jwks.json devuelve un JWKS con el que se puede verificar un JWT RS256', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const kid = 'test-kid-1';
    const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };

    pact
      .given('Auth tiene un par de llaves RS256 activo')
      .uponReceiving('una consulta del JWKS público')
      .withRequest({ method: 'GET', path: '/v1/auth/.well-known/jwks.json' })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          keys: [
            {
              kty: 'RSA',
              n: like(publicJwk.n),
              e: like(publicJwk.e),
              kid: like(kid),
              alg: 'RS256',
              use: 'sig',
            },
          ],
        },
      });

    await pact.executeTest(async (mockServer) => {
      // Mismo patrón que gateway/src/middleware/verify-jwt.ts: JWKS remoto
      // + jwtVerify. El mock devuelve el publicJwk real (mismo n/e que la
      // privateKey usada para firmar), así que esto verifica de punta a
      // punta — no solo que el shape del JSON sea válido.
      const jwks = createRemoteJWKSet(new URL(`${mockServer.url}/v1/auth/.well-known/jwks.json`));
      const token = await new SignJWT({ role: 'ADMIN' })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(privateKey);

      const { payload } = await jwtVerify(token, jwks);
      expect(payload.sub).toBe('user-1');
      expect(payload.role).toBe('ADMIN');
    });
  });
});
