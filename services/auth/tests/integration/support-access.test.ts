import { randomUUID } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { env } from '../../src/config/env.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';

// RFC-004, "Escalada de privilegios: acceso de soporte de plataforma".
const TARGET_TENANT_ID = 'f0000000-f000-f000-f000-f00000000001';
const ACTOR_ID = randomUUID();

describe('POST /v1/auth/support-access (integración con DB real)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : env.PORT;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await withTenantId(
      prisma,
      null,
      (tx) => tx.supportAccessGrant.deleteMany({ where: { actorId: ACTOR_ID } }),
      'platform_admin',
    );
    await app.close();
    await prisma.$disconnect();
  });

  it('platform_support obtiene un JWT de elevación con tenant_id del grant', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/support-access',
      headers: { 'x-internal-user-role': 'platform_support', 'x-internal-user-id': ACTOR_ID },
      payload: { tenantId: TARGET_TENANT_ID, reason: 'Resolviendo ticket #123' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(typeof body.grantId).toBe('string');
    expect(body.expiresIn).toBe(env.ACCESS_TOKEN_TTL_SECONDS);

    const jwks = createRemoteJWKSet(new URL(`${baseUrl}/v1/auth/.well-known/jwks.json`));
    const { payload } = await jwtVerify(body.accessToken, jwks);
    expect(payload['role']).toBe('platform_support');
    expect(payload['tenant_id']).toBe(TARGET_TENANT_ID);
    expect(payload['support_grant_id']).toBe(body.grantId);
  });

  it('un rol de tenant (no plataforma) recibe 403 FORBIDDEN', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/support-access',
      headers: { 'x-internal-user-role': 'clinic_owner', 'x-internal-user-id': randomUUID() },
      payload: { tenantId: TARGET_TENANT_ID, reason: 'Intento no autorizado' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('sin ningún actor (sin header de rol) recibe 403 FORBIDDEN', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/support-access',
      payload: { tenantId: TARGET_TENANT_ID, reason: 'Sin autenticar' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('registra el grant y un OutboxEvent SupportAccessGranted en el tenant objetivo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/support-access',
      headers: { 'x-internal-user-role': 'platform_admin', 'x-internal-user-id': ACTOR_ID },
      payload: { tenantId: TARGET_TENANT_ID, reason: 'Auditoría de facturación', ttlHours: 2 },
    });
    expect(response.statusCode).toBe(201);
    const { grantId } = response.json();

    // RLS de SupportAccessGrant: solo visible con app.actor_role de
    // plataforma seteado (ver migración SQL), independiente del tenant.
    const [grant] = await withTenantId(
      prisma,
      null,
      (tx) => tx.supportAccessGrant.findMany({ where: { id: grantId } }),
      'platform_admin',
    );
    expect(grant).toBeDefined();
    expect(grant?.actorId).toBe(ACTOR_ID);
    expect(grant?.tenantId).toBe(TARGET_TENANT_ID);
    expect(grant?.reason).toBe('Auditoría de facturación');

    const events = await withTenantId(prisma, TARGET_TENANT_ID, (tx) =>
      tx.outboxEvent.findMany({ where: { type: 'SupportAccessGranted' } }),
    );
    const match = events.find((event) => (event.payload as { grantId?: string }).grantId === grantId);
    expect(match).toBeDefined();
  });

  it('RLS: sin app.actor_role de plataforma, SupportAccessGrant no es visible (fail-closed)', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "SupportAccessGrant"`;
    expect(Number(rows[0]?.count ?? -1)).toBe(0);
  });
});
