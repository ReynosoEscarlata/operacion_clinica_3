import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('Docs públicas (Redoc)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs lista los 5 servicios sin requerir token', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.statusCode).toBe(200);
    for (const service of ['auth', 'appointments', 'doctors', 'payments', 'notifications']) {
      expect(response.body).toContain(`/docs/${service}`);
    }
  });

  it('GET /docs/:service sirve la página de Redoc sin token', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/appointments' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<redoc');
    expect(response.body).toContain('/docs/appointments/openapi.yaml');
  });

  it('GET /docs/:service/openapi.yaml sirve el YAML real del contrato', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/appointments/openapi.yaml' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('yaml');
    expect(response.body).toContain('openapi:');
  });

  it('devuelve 404 para un servicio que no existe', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/no-existe' });
    expect(response.statusCode).toBe(404);
  });
});
