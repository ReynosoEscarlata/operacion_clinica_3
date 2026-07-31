import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';

// RFC-004, regla ABAC de propiedad: "un doctor solo ve/opera sobre sus
// propias citas" (appointment.doctorId === actor.doctorId), a diferencia
// del aislamiento de tenant (Fase 3a) esto es DENTRO del mismo tenant --
// dos doctores de la misma clínica, cada uno debe quedar ciego a las citas
// del otro.
const TEST_TENANT_ID = 'd0000000-d000-d000-d000-d00000000001';
const DOCTOR_A = 'd0000000-d000-d000-d000-a00000000001';
const DOCTOR_B = 'd0000000-d000-d000-d000-b00000000002';

const headersForDoctor = (doctorId: string): Record<string, string> => ({
  'x-internal-tenant-id': TEST_TENANT_ID,
  'x-internal-user-role': 'doctor',
  'x-internal-doctor-id': doctorId,
});

// clinic_owner ve todo -- referencia para confirmar que el filtro es
// específico del rol doctor, no un aislamiento de tenant duplicado.
const OWNER_HEADERS = {
  'x-internal-tenant-id': TEST_TENANT_ID,
  'x-internal-user-role': 'clinic_owner',
};

describe('RFC-004: filtro ABAC de propiedad del doctor (Appointments)', () => {
  let app: FastifyInstance;
  let patientId: string;
  let appointmentOfA: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
      const patient = await tx.patient.create({
        data: {
          tenantId: TEST_TENANT_ID,
          email: `paciente-abac-${randomUUID()}@clinica.test`,
          name: 'Paciente ABAC',
          phone: '+52 555 000 0000',
        },
      });
      patientId = patient.id;

      const appointment = await tx.appointment.create({
        data: {
          tenantId: TEST_TENANT_ID,
          patientId,
          doctorId: DOCTOR_A,
          dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
          durationMinutes: 30,
          amountCents: 50_000,
          status: 'REMINDED',
        },
      });
      appointmentOfA = appointment.id;
    });
  });

  afterAll(async () => {
    await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
      await tx.appointmentEvent.deleteMany({ where: { appointmentId: appointmentOfA } });
      await tx.appointment.deleteMany({ where: { patientId } });
      await tx.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    });
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /v1/appointments/:id: doctor B pidiendo la cita de doctor A recibe 404, no 403', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/appointments/${appointmentOfA}`,
      headers: headersForDoctor(DOCTOR_B),
    });
    expect(response.statusCode).toBe(404);
  });

  it('GET /v1/appointments/:id: doctor A (dueño) sí puede verla', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/appointments/${appointmentOfA}`,
      headers: headersForDoctor(DOCTOR_A),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(appointmentOfA);
  });

  it('GET /v1/appointments (list): doctor B nunca ve la cita de doctor A', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/appointments', headers: headersForDoctor(DOCTOR_B) });
    expect(response.statusCode).toBe(200);
    const ids = (response.json().items as Array<{ id: string }>).map((item) => item.id);
    expect(ids).not.toContain(appointmentOfA);
  });

  it('GET /v1/appointments (list): doctor A ve su propia cita', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/appointments', headers: headersForDoctor(DOCTOR_A) });
    expect(response.statusCode).toBe(200);
    const ids = (response.json().items as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toContain(appointmentOfA);
  });

  it('GET /v1/appointments (list): doctor B no puede forzar ?doctorId=A por query param', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/appointments?doctorId=${DOCTOR_A}`,
      headers: headersForDoctor(DOCTOR_B),
    });
    expect(response.statusCode).toBe(200);
    const ids = (response.json().items as Array<{ id: string }>).map((item) => item.id);
    expect(ids).not.toContain(appointmentOfA);
  });

  it('PATCH .../complete: doctor B sobre la cita de doctor A devuelve 404', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointmentOfA}/complete`,
      headers: headersForDoctor(DOCTOR_B),
    });
    expect(response.statusCode).toBe(404);
  });

  it('PATCH .../no-show: doctor B sobre la cita de doctor A devuelve 404', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointmentOfA}/no-show`,
      headers: headersForDoctor(DOCTOR_B),
    });
    expect(response.statusCode).toBe(404);
  });

  it('PATCH .../complete: doctor A (dueño) sí puede completar su propia cita', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/appointments/${appointmentOfA}/complete`,
      headers: headersForDoctor(DOCTOR_A),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('COMPLETED');
  });

  it('clinic_owner no está sujeto al filtro de propiedad -- ve la cita de cualquier doctor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/appointments/${appointmentOfA}`,
      headers: OWNER_HEADERS,
    });
    expect(response.statusCode).toBe(200);
  });
});
