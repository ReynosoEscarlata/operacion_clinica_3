import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';
import type { DoctorsClient } from '../../src/clients/doctors-client.js';
import type { PaymentsClient } from '../../src/clients/payments-client.js';
import { headersFor, TENANT_A, TENANT_B } from '../helpers/tenancy.js';

const CONSULTATION_PRICE_CENTS = 50_000;
const doctorA = randomUUID();
const doctorB = randomUUID();

const buildDateTime = (hour: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return date;
};

const buildFakeDoctorsClient = (): DoctorsClient => ({
  getDoctor: vi.fn().mockImplementation(async (id: string) => {
    if (id === doctorA) return { id: doctorA, tenantId: TENANT_A, consultationPriceCents: CONSULTATION_PRICE_CENTS };
    if (id === doctorB) return { id: doctorB, tenantId: TENANT_B, consultationPriceCents: CONSULTATION_PRICE_CENTS };
    return null;
  }),
  getAvailableSlots: vi.fn().mockImplementation(async () => {
    const slots: string[] = [];
    for (let hour = 9; hour < 12; hour += 1) slots.push(buildDateTime(hour).toISOString());
    return slots;
  }),
});

const buildFakePaymentsClient = (): PaymentsClient => ({
  createCustomer: vi.fn().mockResolvedValue({ id: `cus_${randomUUID()}` }),
  createPaymentIntent: vi.fn().mockResolvedValue({ id: `pi_${randomUUID()}`, clientSecret: 'secret' }),
  cancelPaymentIntent: vi.fn().mockResolvedValue(undefined),
  createRefund: vi.fn().mockResolvedValue({ id: `re_${randomUUID()}` }),
});

// Aislamiento cross-tenant (Fase 3a): cubre tanto las rutas que exigen el
// header (listar, completar, no-show, admin) como las "exentas" del header
// (crean/resuelven su propio tenant vía doctorId o SECURITY DEFINER) --
// estas últimas usan el patrón "ambient-first": si hay tenant ambiental
// (admin autenticado) SIEMPRE se usa ese, nunca se cae al de resolver por
// UUID. Ver docs/runbooks/migracion-tenant-id.md.
describe('Aislamiento cross-tenant: Patients/Appointments/Admin', () => {
  let app: FastifyInstance;
  let patientA: string;
  let patientEmailA: string;
  let appointmentA: string;

  beforeAll(async () => {
    app = await buildApp({
      appointments: {
        doctorsClient: buildFakeDoctorsClient(),
        paymentsClient: buildFakePaymentsClient(),
        enqueueExpiration: vi.fn().mockResolvedValue(undefined),
        enqueueReminder: vi.fn().mockResolvedValue(undefined),
      },
      patients: { paymentsClient: buildFakePaymentsClient(), doctorsClient: buildFakeDoctorsClient() },
    });
    await app.ready();

    patientEmailA = `iso-a-${randomUUID()}@clinica.test`;
    const patientResponse = await app.inject({
      method: 'POST',
      url: '/v1/patients',
      payload: { doctorId: doctorA, email: patientEmailA, name: 'Paciente Aislamiento A', phone: '+52 55 1234 0000' },
    });
    patientA = patientResponse.json().id;

    // Retry en 409 SLOT_UNAVAILABLE: createPending usa una transacción
    // Serializable (detección de doble-reserva) que, bajo la carga
    // concurrente de correr toda la suite de tests en paralelo, puede
    // abortar por un falso conflicto de serialización de Postgres (SQLSTATE
    // 40001, mapeado a este mismo código) sin que exista ninguna cita real
    // en conflicto -- comportamiento ya esperado de SERIALIZABLE, no un bug
    // de este test. Un cliente real reintentaría igual ante un 40001.
    let appointmentResponse = await app.inject({
      method: 'POST',
      url: '/v1/appointments',
      payload: { patientId: patientA, doctorId: doctorA, dateTime: buildDateTime(9).toISOString() },
    });
    if (appointmentResponse.statusCode === 409) {
      appointmentResponse = await app.inject({
        method: 'POST',
        url: '/v1/appointments',
        payload: { patientId: patientA, doctorId: doctorA, dateTime: buildDateTime(9).toISOString() },
      });
    }
    appointmentA = appointmentResponse.json().appointment.id;
  });

  afterAll(async () => {
    await withTenantId(prisma, TENANT_A, async (tx) => {
      await tx.appointment.deleteMany({ where: { patientId: patientA } });
      await tx.patient.delete({ where: { id: patientA } });
    }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  describe('Patients', () => {
    it('GET /v1/patients/:id con header de OTRO tenant (admin) devuelve 404, no cae al resolver público', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientA}`,
        headers: headersFor(TENANT_B),
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /v1/patients/:id sin header (paciente sin cuenta) sí resuelve por UUID', async () => {
      const response = await app.inject({ method: 'GET', url: `/v1/patients/${patientA}` });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(patientA);
    });

    it('PATCH /v1/patients/:id con header de OTRO tenant devuelve 404', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/patients/${patientA}`,
        headers: headersFor(TENANT_B),
        payload: { name: 'Intento Cruzado' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /v1/patients/by-email con el doctorId de OTRO tenant nunca encuentra el paciente', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/patients/by-email?doctorId=${doctorB}&email=${encodeURIComponent(patientEmailA)}`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /v1/patients (list) con header de OTRO tenant nunca incluye pacientes ajenos', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/patients',
        headers: headersFor(TENANT_B),
      });
      expect(response.statusCode).toBe(200);
      const ids = (response.json().data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).not.toContain(patientA);
    });
  });

  describe('Appointments', () => {
    it('GET /v1/appointments/:id con header de OTRO tenant (admin) devuelve 404', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/appointments/${appointmentA}`,
        headers: headersFor(TENANT_B),
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /v1/appointments/:id sin header sí resuelve por UUID (capability-token)', async () => {
      const response = await app.inject({ method: 'GET', url: `/v1/appointments/${appointmentA}` });
      expect(response.statusCode).toBe(200);
    });

    it('PATCH /v1/appointments/:id/cancel con header de OTRO tenant devuelve 404, no cancela nada', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/appointments/${appointmentA}/cancel`,
        headers: headersFor(TENANT_B),
        payload: {},
      });
      expect(response.statusCode).toBe(404);

      const stillActive = await withTenantId(prisma, TENANT_A, (tx) =>
        tx.appointment.findUnique({ where: { id: appointmentA } }),
      );
      expect(stillActive?.status).not.toBe('CANCELLED');
    });

    it('GET /v1/appointments (list) con header de OTRO tenant nunca incluye citas ajenas', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/appointments?doctorId=${doctorA}`,
        headers: headersFor(TENANT_B),
      });
      expect(response.statusCode).toBe(200);
      const ids = (response.json().items as Array<{ id: string }>).map((a) => a.id);
      expect(ids).not.toContain(appointmentA);
    });

    it('PATCH /v1/appointments/:id/complete con header de OTRO tenant devuelve 404', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/appointments/${appointmentA}/complete`,
        headers: headersFor(TENANT_B),
      });
      expect(response.statusCode).toBe(404);
    });

    it('PATCH /v1/appointments/:id/no-show con header de OTRO tenant devuelve 404', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/appointments/${appointmentA}/no-show`,
        headers: headersFor(TENANT_B),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('Admin', () => {
    it('GET /v1/admin/dashboard con el tenant B no cuenta la cita de A', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/dashboard',
        headers: headersFor(TENANT_B),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().appointmentsToday).toBe(0);
    });

    it('GET /v1/admin/events con el tenant B no incluye eventos de la cita de A', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/events?hours=720',
        headers: headersFor(TENANT_B),
      });
      expect(response.statusCode).toBe(200);
      const events = response.json() as Array<{ appointmentId: string }>;
      expect(events.some((event) => event.appointmentId === appointmentA)).toBe(false);
    });

    it('dead-letter: una entrada de A no aparece listada ni es accesible por retry/delete desde B', async () => {
      const entry = await withTenantId(prisma, TENANT_A, (tx) =>
        tx.deadLetterEntry.create({
          data: {
            tenantId: TENANT_A,
            eventId: randomUUID(),
            eventType: 'PaymentSucceeded',
            payload: {},
            error: 'boom',
            attempts: 5,
          },
        }),
      );

      try {
        const listResponse = await app.inject({
          method: 'GET',
          url: '/v1/admin/dead-letter',
          headers: headersFor(TENANT_B),
        });
        expect(listResponse.statusCode).toBe(200);
        expect(listResponse.json().data.some((row: { id: string }) => row.id === entry.id)).toBe(false);

        const retryResponse = await app.inject({
          method: 'POST',
          url: `/v1/admin/dead-letter/${entry.id}/retry`,
          headers: headersFor(TENANT_B),
        });
        expect(retryResponse.statusCode).toBe(404);

        const deleteResponse = await app.inject({
          method: 'DELETE',
          url: `/v1/admin/dead-letter/${entry.id}`,
          headers: headersFor(TENANT_B),
        });
        expect(deleteResponse.statusCode).toBe(404);
      } finally {
        await withTenantId(prisma, TENANT_A, (tx) =>
          tx.deadLetterEntry.delete({ where: { id: entry.id } }),
        ).catch(() => undefined);
      }
    });
  });

  describe('Base de datos', () => {
    it('sin app.current_tenant seteado, app_role no ve ninguna fila de "Patient" ni "Appointment"', async () => {
      const patientRows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "Patient"`;
      const appointmentRows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "Appointment"`;
      expect(Number(patientRows[0]?.count ?? -1)).toBe(0);
      expect(Number(appointmentRows[0]?.count ?? -1)).toBe(0);
    });
  });
});
