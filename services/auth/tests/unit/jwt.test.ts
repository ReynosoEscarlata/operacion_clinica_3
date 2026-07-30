import { jwtVerify, createLocalJWKSet } from 'jose';
import { describe, expect, it } from 'vitest';

import { getSigningKeys } from '../../src/lib/keys.js';
import { signAccessToken } from '../../src/lib/jwt.js';

describe('JWT stateless con JWKS (RFC-001 decisión 2)', () => {
  it('firma un token verificable con la llave pública publicada en JWKS', async () => {
    const token = await signAccessToken({
      sub: 'user-1',
      role: 'clinic_owner',
      tenantId: '11111111-1111-1111-1111-111111111111',
      doctorId: null,
    });
    const { publicJwk } = await getSigningKeys();

    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    const { payload } = await jwtVerify(token, jwks);

    expect(payload.sub).toBe('user-1');
    expect(payload['role']).toBe('clinic_owner');
    expect(payload['tenant_id']).toBe('11111111-1111-1111-1111-111111111111');
    expect(payload['doctor_id']).toBeNull();
  });

  it('firma tenant_id null para roles de plataforma (RFC-003)', async () => {
    const token = await signAccessToken({ sub: 'user-1', role: 'platform_admin', tenantId: null, doctorId: null });
    const { publicJwk } = await getSigningKeys();
    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    const { payload } = await jwtVerify(token, jwks);

    expect(payload['tenant_id']).toBeNull();
  });

  it('firma doctor_id para role doctor (RFC-004, filtro ABAC de propiedad)', async () => {
    const token = await signAccessToken({
      sub: 'user-1',
      role: 'doctor',
      tenantId: '11111111-1111-1111-1111-111111111111',
      doctorId: '22222222-2222-2222-2222-222222222222',
    });
    const { publicJwk } = await getSigningKeys();
    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    const { payload } = await jwtVerify(token, jwks);

    expect(payload['doctor_id']).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('rechaza un token firmado con una llave distinta', async () => {
    const token = await signAccessToken({
      sub: 'user-1',
      role: 'clinic_owner',
      tenantId: '11111111-1111-1111-1111-111111111111',
      doctorId: null,
    });

    // JWKS con un kid que no coincide con el de la llave real, simulando
    // un servicio que cacheó un JWKS desactualizado.
    const { publicJwk } = await getSigningKeys();
    const tamperedJwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'otro-kid' }] });

    await expect(jwtVerify(token, tamperedJwks)).rejects.toThrow();
  });
});
