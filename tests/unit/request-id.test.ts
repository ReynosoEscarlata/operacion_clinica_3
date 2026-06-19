import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { registerRequestId } from '../../src/middleware/request-id.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const buildTestApp = (): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerRequestId(app);

  app.get('/ping', async (request) => ({
    requestId: request.requestId,
    logBindings: (request.log as unknown as pino.Logger).bindings(),
  }));

  return app;
};

describe('registerRequestId', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('genera un requestId tipo uuid v4 cuando no llega en el header', async () => {
    app = buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/ping' });

    expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
    expect(response.json().requestId).toBe(response.headers['x-request-id']);
  });

  it('propaga el requestId recibido en el header de la petición', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-request-id': 'mi-id-personalizado' },
    });

    expect(response.headers['x-request-id']).toBe('mi-id-personalizado');
    expect(response.json().requestId).toBe('mi-id-personalizado');
  });

  it('vincula el requestId a los logs de la petición (request.log)', async () => {
    app = buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-request-id': 'log-binding-test' },
    });

    expect(response.json().logBindings).toMatchObject({ requestId: 'log-binding-test' });
  });
});
