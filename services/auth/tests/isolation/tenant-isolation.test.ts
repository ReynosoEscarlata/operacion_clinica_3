import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';
import { headersFor, TENANT_A, TENANT_B } from '../helpers/tenancy.js';

// Aislamiento cross-tenant (Fase 3a): un actor autenticado en el tenant A
// nunca debe poder leer, enumerar ni mutar datos del tenant B, ni al revés.
// Ver docs/runbooks/migracion-tenant-id.md.
describe('Aislamiento cross-tenant: Users', () => {
  let app: FastifyInstance;
  let userInA: string;
  let userInB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const createResponseA = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: headersFor(TENANT_A),
      payload: {
        email: `iso-a-${randomUUID()}@clinica.test`,
        name: 'Usuario Tenant A',
        role: 'RECEPTIONIST',
        password: 'super-secreta',
      },
    });
    userInA = createResponseA.json().id;

    const createResponseB = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: headersFor(TENANT_B),
      payload: {
        email: `iso-b-${randomUUID()}@clinica.test`,
        name: 'Usuario Tenant B',
        role: 'RECEPTIONIST',
        password: 'super-secreta',
      },
    });
    userInB = createResponseB.json().id;
  });

  afterAll(async () => {
    await withTenantId(prisma, TENANT_A, (tx) => tx.user.delete({ where: { id: userInA } })).catch(
      () => undefined,
    );
    await withTenantId(prisma, TENANT_B, (tx) => tx.user.delete({ where: { id: userInB } })).catch(
      () => undefined,
    );
    await app.close();
    await prisma.$disconnect();
  });

  it('PATCH deactivate de un usuario de OTRO tenant devuelve 404, no 403 (nunca confirma que existe)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${userInB}/deactivate`,
      headers: headersFor(TENANT_A),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('GET /v1/users con el header del tenant A nunca incluye usuarios del tenant B (enumeración)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: headersFor(TENANT_A),
    });

    expect(response.statusCode).toBe(200);
    const ids = (response.json().data as Array<{ id: string }>).map((user) => user.id);
    expect(ids).toContain(userInA);
    expect(ids).not.toContain(userInB);
  });

  it('a nivel de base de datos: sin app.current_tenant seteado, app_role no ve ninguna fila de "User"', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "User"`;
    expect(Number(rows[0]?.count ?? -1)).toBe(0);
  });

  it('a nivel de base de datos: con app.current_tenant = A, un SELECT * sin WHERE solo devuelve filas de A', async () => {
    const rows = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.$queryRaw<Array<{ id: string; tenantId: string | null }>>`SELECT id, "tenantId" FROM "User"`,
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenantId === TENANT_A)).toBe(true);
    expect(rows.some((row) => row.id === userInB)).toBe(false);
  });

  // Fase 6 (ADR-017): agregado cross-tenant por diseño -- el "aislamiento"
  // que importa acá es que un rol de tenant nunca lo alcance.
  describe('Platform (dashboard ejecutivo, ADR-017)', () => {
    it('GET /v1/platform-users/active con un actor de plataforma (sin header de tenant) responde 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/platform-users/active',
        headers: { 'x-internal-user-role': 'platform_admin' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('activeByRole');
    });

    it('GET /v1/platform-users/active con un rol de tenant (clinic_owner) responde 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/platform-users/active',
        headers: headersFor(TENANT_A),
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
