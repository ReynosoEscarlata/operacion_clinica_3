import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';

// RFC-004, regla ABAC de propiedad: doctor:manage_availability es 'own'
// para el rol doctor -- solo puede gestionar SU PROPIA disponibilidad,
// nunca la de otro doctor de la misma clínica (a diferencia del 404 de
// aislamiento de tenant, esto responde 403: el :id ya es público vía
// doctor:read, no hay nada que ocultar sobre su existencia).
const TEST_TENANT_ID = 'e0000000-e000-e000-e000-e00000000001';

describe('RFC-004: filtro ABAC de propiedad del doctor (Doctors)', () => {
  let app: FastifyInstance;
  let doctorAId: string;
  let doctorBId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
      const specialty = await tx.medicalSpecialty.findFirstOrThrow();
      const doctorA = await tx.doctor.create({
        data: {
          tenantId: TEST_TENANT_ID,
          name: 'Dr. A',
          email: `doctor-a-${randomUUID()}@clinica.test`,
          specialtyId: specialty.id,
        },
      });
      const doctorB = await tx.doctor.create({
        data: {
          tenantId: TEST_TENANT_ID,
          name: 'Dr. B',
          email: `doctor-b-${randomUUID()}@clinica.test`,
          specialtyId: specialty.id,
        },
      });
      doctorAId = doctorA.id;
      doctorBId = doctorB.id;
    });
  });

  afterAll(async () => {
    await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
      await tx.availability.deleteMany({ where: { doctorId: { in: [doctorAId, doctorBId] } } });
      await tx.doctor.deleteMany({ where: { id: { in: [doctorAId, doctorBId] } } });
    });
    await app.close();
    await prisma.$disconnect();
  });

  it('doctor B no puede configurar disponibilidad de doctor A -- 403 FORBIDDEN', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/doctors/${doctorAId}/availability`,
      headers: {
        'x-internal-tenant-id': TEST_TENANT_ID,
        'x-internal-user-role': 'doctor',
        'x-internal-doctor-id': doctorBId,
      },
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('doctor A sí puede configurar su propia disponibilidad', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/doctors/${doctorAId}/availability`,
      headers: {
        'x-internal-tenant-id': TEST_TENANT_ID,
        'x-internal-user-role': 'doctor',
        'x-internal-doctor-id': doctorAId,
      },
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
    });

    expect(response.statusCode).toBe(201);
  });

  it('clinic_owner no está sujeto al filtro de propiedad -- puede configurar la de cualquier doctor', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/doctors/${doctorBId}/availability`,
      headers: { 'x-internal-tenant-id': TEST_TENANT_ID, 'x-internal-user-role': 'clinic_owner' },
      payload: { dayOfWeek: 2, startTime: '09:00', endTime: '12:00' },
    });

    expect(response.statusCode).toBe(201);
  });
});
