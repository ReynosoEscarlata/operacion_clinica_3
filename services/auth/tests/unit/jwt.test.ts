import { jwtVerify, createLocalJWKSet } from 'jose';
import { describe, expect, it } from 'vitest';

import { getSigningKeys } from '../../src/lib/keys.js';
import { signAccessToken } from '../../src/lib/jwt.js';

describe('JWT stateless con JWKS (RFC-001 decisión 2)', () => {
  it('firma un token verificable con la llave pública publicada en JWKS', async () => {
    const token = await signAccessToken({ sub: 'user-1', role: 'ADMIN' });
    const { publicJwk } = await getSigningKeys();

    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    const { payload } = await jwtVerify(token, jwks);

    expect(payload.sub).toBe('user-1');
    expect(payload['role']).toBe('ADMIN');
  });

  it('rechaza un token firmado con una llave distinta', async () => {
    const token = await signAccessToken({ sub: 'user-1', role: 'ADMIN' });

    // JWKS con un kid que no coincide con el de la llave real, simulando
    // un servicio que cacheó un JWKS desactualizado.
    const { publicJwk } = await getSigningKeys();
    const tamperedJwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'otro-kid' }] });

    await expect(jwtVerify(token, tamperedJwks)).rejects.toThrow();
  });
});
