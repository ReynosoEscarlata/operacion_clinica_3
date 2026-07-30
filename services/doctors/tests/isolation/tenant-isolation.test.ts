import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';
import { headersFor, TENANT_A, TENANT_B } from '../helpers/tenancy.js';

// Aislamiento cross-tenant (Fase 3a): a diferencia de Auth/Appointments, el
// directorio de Doctores es de LECTURA pública por diseño (RLS asimétrico)
// -- lo que debe permanecer aislado son las ESCRITURAS (crear un doctor,
// agregar disponibilidad). Ver docs/runbooks/migracion-tenant-id.md.
describe('Aislamiento cross-tenant: Doctors (escrituras)', () => {
  let app: FastifyInstance;
  let doctorInA: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/doctors',
      headers: headersFor(TENANT_A),
      payload: { name: 'Dra. Aislamiento', email: `iso-doctor-${Date.now()}@clinica.test`, specialty: 'Medicina General' },
    });
    doctorInA = createResponse.json().id;
  });

  afterAll(async () => {
    await withTenantId(prisma, TENANT_A, async (tx) => {
      await tx.availability.deleteMany({ where: { doctorId: doctorInA } });
      await tx.doctor.delete({ where: { id: doctorInA } });
    }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  it('un doctor creado por el tenant A queda etiquetado con su propio tenantId', async () => {
    const stored = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.doctor.findUnique({ where: { id: doctorInA } }),
    );
    expect(stored?.tenantId).toBe(TENANT_A);
  });

  it('POST /v1/doctors/:id/availability contra un doctor de OTRO tenant devuelve 404, no inyecta disponibilidad ajena', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/doctors/${doctorInA}/availability`,
      headers: headersFor(TENANT_B),
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('DOCTOR_NOT_FOUND');

    const injected = await withTenantId(prisma, TENANT_B, (tx) =>
      tx.availability.findMany({ where: { doctorId: doctorInA } }),
    );
    expect(injected).toHaveLength(0);
  });

  it('POST /v1/doctors/:id/availability con el propio tenant sí agrega el bloque, etiquetado con ese tenant', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/doctors/${doctorInA}/availability`,
      headers: headersFor(TENANT_A),
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().tenantId).toBe(TENANT_A);
  });

  it('a nivel de base de datos: OutboxEvent (sin policy pública, a diferencia de Doctor) sí aísla -- sin app.current_tenant seteado, app_role no ve ninguna fila', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "OutboxEvent"`;
    expect(Number(rows[0]?.count ?? -1)).toBe(0);
  });
});
