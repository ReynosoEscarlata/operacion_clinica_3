import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { errorHandler } from '../../src/middleware/error-handler.js';
import { registerRequestId } from '../../src/middleware/request-id.js';
import { registerPatientRoutes } from '../../src/modules/patients/index.js';
import type { PatientRepository } from '../../src/modules/patients/patients.repository.js';
import type { StripeCustomersClient } from '../../src/modules/patients/patients.service.js';

const unusedRepository: PatientRepository = {
  create: () => Promise.reject(new Error('no debería llamarse: input inválido')),
  findByEmail: () => Promise.reject(new Error('no debería llamarse: input inválido')),
  findById: () => Promise.reject(new Error('no debería llamarse: input inválido')),
  update: () => Promise.reject(new Error('no debería llamarse: input inválido')),
  list: () => Promise.reject(new Error('no debería llamarse: input inválido')),
};

const unusedStripeClient: StripeCustomersClient = {
  customers: {
    create: () => Promise.reject(new Error('no debería llamarse: input inválido')),
  },
};

const buildTestApp = (): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerRequestId(app);
  app.setErrorHandler(errorHandler);
  registerPatientRoutes(app, { repository: unusedRepository, stripeClient: unusedStripeClient });
  return app;
};

describe('Validación de inputs — Patients', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('rechaza un email inválido al crear paciente', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/patients',
      payload: { email: 'no-es-un-email', name: 'Ana Torres', phone: '+54 9 11 5555-0001' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza un teléfono con formato incorrecto al crear paciente', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/patients',
      payload: { email: 'ana@example.com', name: 'Ana Torres', phone: 'abc' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza un body sin name al crear paciente', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/patients',
      payload: { email: 'ana@example.com', phone: '+54 9 11 5555-0001' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza un id que no es uuid al obtener un paciente', async () => {
    app = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/patients/no-es-un-uuid' });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza un limit fuera de rango al listar pacientes', async () => {
    app = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/patients?limit=1000' });

    expect(response.statusCode).toBe(400);
  });
});
