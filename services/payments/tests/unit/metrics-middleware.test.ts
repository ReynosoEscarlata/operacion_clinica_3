import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerMetricsMiddleware } from '../../src/middleware/metrics.js';
import { metricsRegistry } from '../../src/lib/metrics.js';

describe('registerMetricsMiddleware', () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it('cuenta requests y registra duración por método/ruta/status, usando el patrón de ruta (no la URL con ids)', async () => {
    const app = Fastify({ logger: false });
    registerMetricsMiddleware(app);
    app.get('/v1/appointments/:id', async () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/v1/appointments/11111111-1111-1111-1111-111111111111' });
    await app.inject({ method: 'GET', url: '/v1/appointments/22222222-2222-2222-2222-222222222222' });

    const metrics = await metricsRegistry.metrics();
    expect(metrics).toContain(
      'http_requests_total{method="GET",route="/v1/appointments/:id",status_code="200"} 2',
    );
    expect(metrics).toContain('http_request_duration_seconds');
    await app.close();
  });

  it('incrementa http_request_errors_total solo para status >= 500', async () => {
    const app = Fastify({ logger: false });
    registerMetricsMiddleware(app);
    app.get('/boom', async () => {
      throw new Error('boom');
    });
    app.get('/not-found-ish', async (_request, reply) => reply.status(404).send({ error: 'nope' }));

    await app.inject({ method: 'GET', url: '/boom' });
    await app.inject({ method: 'GET', url: '/not-found-ish' });

    const metrics = await metricsRegistry.metrics();
    expect(metrics).toContain('http_request_errors_total{method="GET",route="/boom"} 1');
    expect(metrics).not.toContain('http_request_errors_total{method="GET",route="/not-found-ish"}');
    await app.close();
  });
});
