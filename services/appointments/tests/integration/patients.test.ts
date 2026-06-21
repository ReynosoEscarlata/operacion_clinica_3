import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { AppError } from '../../src/lib/app-error.js';
import type { PaymentsClient } from '../../src/clients/payments-client.js';

const fakePaymentsClient: PaymentsClient = {
  createCustomer: vi.fn().mockResolvedValue({ id: 'cus_fake_123' }),
  createPaymentIntent: vi.fn(),
  cancelPaymentIntent: vi.fn(),
  createRefund: vi.fn(),
};

describe('Patients CRUD (integración con DB real, Payments mockeado)', () => {
  let app: FastifyInstance;
  const testEmail = `patient-${randomUUID()}@example.com`;
  let createdId: string;

  beforeAll(async () => {
    app = await buildApp({ patients: { paymentsClient: fakePaymentsClient } });
    await app.ready();
  });

  afterAll(async () => {
    if (createdId) {
      await prisma.patient.delete({ where: { id: createdId } }).catch(() => undefined);
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('crea un paciente y un Stripe Customer asociado vía Payments', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/patients',
      payload: { email: testEmail, name: 'Test Patient', phone: '+54 9 11 5555-9999' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.stripeCustomerId).toBe('cus_fake_123');
    expect(fakePaymentsClient.createCustomer).toHaveBeenCalledWith(testEmail, 'Test Patient');

    createdId = body.id;
  });

  it('rechaza crear un paciente duplicado por email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/patients',
      payload: { email: testEmail, name: 'Otro Nombre', phone: '+54 9 11 5555-0000' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PATIENT_EMAIL_TAKEN');
  });

  it('obtiene el paciente creado con sus citas (vacías)', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/patients/${createdId}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(createdId);
    expect(body.appointments).toEqual([]);
  });

  it('retorna 404 al buscar un paciente inexistente', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/${randomUUID()}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PATIENT_NOT_FOUND');
  });

  it('busca un paciente por email (usado por el flujo público de reserva)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/by-email?email=${encodeURIComponent(testEmail)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(createdId);
  });

  it('retorna 404 al buscar por un email que no existe', async () => {
    const unknownEmail = `nadie-${randomUUID()}@example.com`;
    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/by-email?email=${encodeURIComponent(unknownEmail)}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PATIENT_NOT_FOUND');
  });

  it('rechaza un email con formato inválido en la búsqueda por email', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/patients/by-email?email=no-es-un-email',
    });

    expect(response.statusCode).toBe(400);
  });

  it('actualiza el nombre del paciente y registra PatientUpdated en el Outbox', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/patients/${createdId}`,
      payload: { name: 'Nombre Actualizado' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Nombre Actualizado');

    const events = await prisma.outboxEvent.findMany({ where: { type: 'PatientUpdated' } });
    const match = events.find((event) => (event.payload as { patientId?: string }).patientId === createdId);
    expect(match).toBeDefined();
    expect(match?.publishedAt).toBeNull();
  });

  it('retorna 404 al actualizar un paciente inexistente', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/patients/${randomUUID()}`,
      payload: { name: 'No existe' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('lista pacientes con paginación cursor-based', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/patients?limit=1' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(typeof body.nextCursor === 'string' || body.nextCursor === null).toBe(true);
  });

  it('retorna 502 con PAYMENTS_UNAVAILABLE si Payments falla al crear el customer', async () => {
    const failingPaymentsClient: PaymentsClient = {
      ...fakePaymentsClient,
      createCustomer: vi
        .fn()
        .mockRejectedValue(new AppError(502, 'PAYMENTS_UNAVAILABLE', 'Servicio de pago no disponible')),
    };
    const failingApp = await buildApp({ patients: { paymentsClient: failingPaymentsClient } });
    await failingApp.ready();

    const response = await failingApp.inject({
      method: 'POST',
      url: '/v1/patients',
      payload: {
        email: `fail-${randomUUID()}@example.com`,
        name: 'Payments Down',
        phone: '+54 9 11 5555-0001',
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('PAYMENTS_UNAVAILABLE');

    await failingApp.close();
  });
});
