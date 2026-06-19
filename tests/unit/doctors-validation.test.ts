import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { errorHandler } from '../../src/middleware/error-handler.js';
import { registerRequestId } from '../../src/middleware/request-id.js';
import { registerDoctorRoutes } from '../../src/modules/doctors/index.js';
import type { DoctorRepository } from '../../src/modules/doctors/doctors.repository.js';

const fail = (): never => {
  throw new Error('no debería llamarse: input inválido');
};

const unusedRepository: DoctorRepository = {
  create: fail,
  findById: fail,
  exists: fail,
  findBasicById: fail,
  findAll: fail,
  replaceAvailability: fail,
  findAvailabilityForDay: fail,
  findAppointmentsBetween: fail,
};

const buildTestApp = (): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerRequestId(app);
  app.setErrorHandler(errorHandler);
  registerDoctorRoutes(app, { repository: unusedRepository });
  return app;
};

describe('Validación de inputs — Doctors', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('rechaza un email inválido al crear doctor', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/doctors',
      payload: { name: 'Dr. Test', email: 'no-es-un-email', specialty: 'Cardiología' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza un dayOfWeek fuera de rango al definir disponibilidad', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: `/api/doctors/${'00000000-0000-0000-0000-000000000000'}/availability`,
      payload: { availability: [{ dayOfWeek: 9, startTime: '09:00', endTime: '13:00' }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza un startTime con formato incorrecto al definir disponibilidad', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: `/api/doctors/${'00000000-0000-0000-0000-000000000000'}/availability`,
      payload: { availability: [{ dayOfWeek: 1, startTime: '9am', endTime: '13:00' }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza una fecha con formato incorrecto al pedir slots', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: `/api/doctors/${'00000000-0000-0000-0000-000000000000'}/slots?date=15-01-2025`,
    });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza un id que no es uuid al pedir slots', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/doctors/no-es-un-uuid/slots?date=2026-06-22',
    });

    expect(response.statusCode).toBe(400);
  });
});
