import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import type { StripeCustomersClient } from '../../src/modules/patients/patients.service.js';

const fakeStripeClient: StripeCustomersClient = {
  customers: {
    create: vi.fn().mockResolvedValue({ id: 'cus_fake_123' }),
  },
};

describe('Patients CRUD (integración con DB real, Stripe mockeado)', () => {
  let app: FastifyInstance;
  const testEmail = `patient-${randomUUID()}@example.com`;
  let createdId: string;

  beforeAll(async () => {
    app = buildApp({ patients: { stripeClient: fakeStripeClient } });
    await app.ready();
  });

  afterAll(async () => {
    if (createdId) {
      await prisma.patient.delete({ where: { id: createdId } }).catch(() => undefined);
    }
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('crea un paciente y un Stripe Customer asociado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/patients',
      payload: { email: testEmail, name: 'Test Patient', phone: '+54 9 11 5555-9999' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.stripeCustomerId).toBe('cus_fake_123');
    expect(fakeStripeClient.customers.create).toHaveBeenCalledWith({
      email: testEmail,
      name: 'Test Patient',
    });

    createdId = body.id;
  });

  it('rechaza crear un paciente duplicado por email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/patients',
      payload: { email: testEmail, name: 'Otro Nombre', phone: '+54 9 11 5555-0000' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PATIENT_EMAIL_TAKEN');
  });

  it('obtiene el paciente creado con sus citas (vacías)', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/patients/${createdId}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(createdId);
    expect(body.appointments).toEqual([]);
  });

  it('retorna 404 al buscar un paciente inexistente', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/patients/00000000-0000-0000-0000-000000000000',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PATIENT_NOT_FOUND');
  });

  it('busca un paciente por email (usado por el flujo público de reserva)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/patients/by-email?email=${encodeURIComponent(testEmail)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(createdId);
  });

  it('retorna 404 al buscar por un email que no existe', async () => {
    const unknownEmail = `nadie-${randomUUID()}@example.com`;
    const response = await app.inject({
      method: 'GET',
      url: `/api/patients/by-email?email=${encodeURIComponent(unknownEmail)}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PATIENT_NOT_FOUND');
  });

  it('rechaza un email con formato inválido en la búsqueda por email', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/patients/by-email?email=no-es-un-email',
    });

    expect(response.statusCode).toBe(400);
  });

  it('actualiza el nombre del paciente', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/patients/${createdId}`,
      payload: { name: 'Nombre Actualizado' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Nombre Actualizado');
  });

  it('retorna 404 al actualizar un paciente inexistente', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/patients/00000000-0000-0000-0000-000000000000',
      payload: { name: 'No existe' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('lista pacientes con paginación cursor-based', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/patients?limit=1' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(typeof body.nextCursor === 'string' || body.nextCursor === null).toBe(true);
  });

  it('retorna 502 con STRIPE_UNAVAILABLE si Stripe falla al crear el customer', async () => {
    const failingStripeClient: StripeCustomersClient = {
      customers: { create: vi.fn().mockRejectedValue(new Error('stripe down')) },
    };
    const failingApp = buildApp({ patients: { stripeClient: failingStripeClient } });
    await failingApp.ready();

    const response = await failingApp.inject({
      method: 'POST',
      url: '/api/patients',
      payload: {
        email: `fail-${randomUUID()}@example.com`,
        name: 'Stripe Down',
        phone: '+54 9 11 5555-0001',
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('STRIPE_UNAVAILABLE');

    await failingApp.close();
  });
});
