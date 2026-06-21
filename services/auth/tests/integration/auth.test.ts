import { randomUUID } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { env } from '../../src/config/env.js';

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
      payload: { email, name: 'Admin de Prueba', role: 'ADMIN', password },
    });
    userId = created.json().id;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
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
    expect(payload['role']).toBe('ADMIN');
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
    await app.inject({ method: 'PATCH', url: `/v1/users/${userId}/deactivate` });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(401);
  });
});
