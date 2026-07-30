import { randomUUID } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { env } from '../../src/config/env.js';
import { hashPassword } from '../../src/lib/password.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';

const TEST_TENANT_ID = '44444444-4444-4444-4444-444444444444';
// role clinic_owner (RFC-004): tiene user:create/user:deactivate en 'all'
// -- necesario ahora que /v1/users exige requirePermission().
const TENANT_HEADERS = { 'x-internal-tenant-id': TEST_TENANT_ID, 'x-internal-user-role': 'clinic_owner' };

describe('Login / refresh / JWKS (integración con DB real)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const email = `admin-${randomUUID()}@clinica.test`;
  const password = 'password-correcto-123';
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : env.PORT;
    baseUrl = `http://127.0.0.1:${port}`;

    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: TENANT_HEADERS,
      payload: { email, name: 'Admin de Prueba', role: 'CLINIC_OWNER', password },
    });
    userId = created.json().id;
  });

  afterAll(async () => {
    await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } }).catch(() => undefined);
    });
    await app.close();
    await prisma.$disconnect();
  });

  it('login exitoso devuelve un access token verificable con el JWKS publicado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    const { accessToken, refreshToken, expiresIn } = response.json();
    expect(typeof accessToken).toBe('string');
    expect(typeof refreshToken).toBe('string');
    expect(expiresIn).toBeGreaterThan(0);

    // Validación end-to-end real: el JWKS se sirve por HTTP (no en memoria
    // del mismo proceso), igual que lo haría el gateway o cualquier otro
    // servicio (RFC-001 decisión 2).
    const jwks = createRemoteJWKSet(new URL(`${baseUrl}/v1/auth/.well-known/jwks.json`));
    const { payload } = await jwtVerify(accessToken, jwks);
    expect(payload.sub).toBe(userId);
    expect(payload['role']).toBe('clinic_owner');
    expect(payload['tenant_id']).toBe(TEST_TENANT_ID);
    expect(payload['doctor_id']).toBeNull();
  });

  it('login con password incorrecto retorna 401 UNAUTHORIZED', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'incorrecto' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('refresh rota el token y el anterior deja de ser válido', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    const { refreshToken } = loginResponse.json();

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(refreshResponse.statusCode).toBe(200);
    const { refreshToken: newRefreshToken } = refreshResponse.json();
    expect(newRefreshToken).not.toBe(refreshToken);

    const reuseResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(reuseResponse.statusCode).toBe(401);
  });

  it('un usuario desactivado no puede loguearse', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/v1/users/${userId}/deactivate`,
      headers: TENANT_HEADERS,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(401);
  });
});

// Fase 4 (RFC-004): platform_admin/platform_support ahora pueden loguearse
// (tenantId null) -- antes bloqueado explícitamente en auth.service.ts.
// No hay todavía una ruta que cree un usuario de plataforma vía la API
// (requirePermission/authz-context llega en un commit posterior), así que
// el usuario se inserta directo con withTenantId(..., null, ..., actorRole)
// -- exactamente el mismo camino que usaría el motor de permisos.
describe('Login de usuario de plataforma (integración con DB real)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const email = `platform-admin-${randomUUID()}@clinica.test`;
  const password = 'password-correcto-123';
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : env.PORT;
    baseUrl = `http://127.0.0.1:${port}`;

    const passwordHash = await hashPassword(password);
    const user = await withTenantId(
      prisma,
      null,
      (tx) =>
        tx.user.create({
          data: { email, name: 'Platform Admin de Prueba', role: 'PLATFORM_ADMIN', passwordHash },
        }),
      'platform_admin',
    );
    userId = user.id;
  });

  afterAll(async () => {
    await withTenantId(
      prisma,
      null,
      async (tx) => {
        await tx.refreshToken.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } }).catch(() => undefined);
      },
      'platform_admin',
    );
    await app.close();
    await prisma.$disconnect();
  });

  it('login exitoso emite un access token con tenant_id null', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    const { accessToken, refreshToken } = response.json();
    expect(typeof refreshToken).toBe('string');

    const jwks = createRemoteJWKSet(new URL(`${baseUrl}/v1/auth/.well-known/jwks.json`));
    const { payload } = await jwtVerify(accessToken, jwks);
    expect(payload.sub).toBe(userId);
    expect(payload['role']).toBe('platform_admin');
    expect(payload['tenant_id']).toBeNull();
  });

  it('refresh también funciona para un usuario de plataforma', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    const { refreshToken } = loginResponse.json();

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(refreshResponse.statusCode).toBe(200);
    expect(refreshResponse.json().refreshToken).not.toBe(refreshToken);
  });
});

// Fase 4 (RFC-004): el claim doctor_id del JWT alimenta el filtro ABAC de
// propiedad ("un doctor solo ve sus propias citas") que se aplica más
// adelante en appointments/doctors.
describe('Login de usuario con rol doctor propaga doctorId en el JWT (integración con DB real)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const email = `doctor-${randomUUID()}@clinica.test`;
  const password = 'password-correcto-123';
  const doctorId = '55555555-5555-5555-5555-555555555555';
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : env.PORT;
    baseUrl = `http://127.0.0.1:${port}`;

    const created = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: TENANT_HEADERS,
      payload: { email, name: 'Dr. de Prueba', role: 'DOCTOR', doctorId, password },
    });
    userId = created.json().id;
  });

  afterAll(async () => {
    await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } }).catch(() => undefined);
    });
    await app.close();
    await prisma.$disconnect();
  });

  it('el access token incluye doctor_id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    const { accessToken } = response.json();

    const jwks = createRemoteJWKSet(new URL(`${baseUrl}/v1/auth/.well-known/jwks.json`));
    const { payload } = await jwtVerify(accessToken, jwks);
    expect(payload['role']).toBe('doctor');
    expect(payload['doctor_id']).toBe(doctorId);
  });
});
