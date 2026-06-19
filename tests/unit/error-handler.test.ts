import { Type } from '@sinclair/typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sentry } from '../../src/config/sentry.js';
import { AppError } from '../../src/lib/app-error.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { registerRequestId } from '../../src/middleware/request-id.js';

const buildTestApp = (): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerRequestId(app);
  app.setErrorHandler(errorHandler);

  app.get('/operational-error', async () => {
    throw new AppError(409, 'SLOT_UNAVAILABLE', 'El horario ya no está disponible');
  });

  app.get('/unexpected-error', async () => {
    throw new Error('boom');
  });

  app.get('/non-operational-app-error', async () => {
    throw new AppError(500, 'BUG', 'Algo salió mal', false);
  });

  app.post(
    '/schema-validated',
    { schema: { body: Type.Object({ email: Type.String({ format: 'email' }) }) } },
    async () => ({ ok: true }),
  );

  return app;
};

describe('errorHandler', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.spyOn(Sentry, 'captureException').mockReturnValue('');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('responde con el statusCode y code de un AppError operacional, sin reportar a Sentry', async () => {
    app = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/operational-error' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'SLOT_UNAVAILABLE', message: 'El horario ya no está disponible' },
    });
    expect(response.json().error.requestId).toBeDefined();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('responde 500 genérico para un Error no controlado, sin exponer el stack, y lo reporta a Sentry', async () => {
    app = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/unexpected-error' });
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Error interno del servidor');
    expect(body.error).not.toHaveProperty('stack');
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ requestId: expect.any(String) }) }),
    );
  });

  it('responde 500 genérico para un AppError no operacional (bug) y lo reporta a Sentry', async () => {
    app = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/non-operational-app-error' });
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Error interno del servidor');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('responde 400 con código VALIDATION_ERROR cuando el body no cumple el schema, sin reportar a Sentry', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/schema-validated',
      payload: { email: 'no-es-un-email' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.requestId).toBeDefined();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
