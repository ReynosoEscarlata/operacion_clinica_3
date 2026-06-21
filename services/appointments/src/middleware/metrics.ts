import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { httpRequestDurationSeconds, httpRequestErrorsTotal, httpRequestsTotal } from '../lib/metrics.js';

const requestStartTimes = new WeakMap<FastifyRequest, bigint>();

// Instrumenta cada request con las 3 métricas RED. Se usa `routerPath` (el
// patrón de ruta registrado, ej. "/v1/appointments/:id") y no `url` —
// si no, Prometheus termina con una serie de tiempo distinta por cada UUID,
// lo que vuelve inútiles los dashboards y satura cardinalidad.
export const registerMetricsMiddleware = (app: FastifyInstance): void => {
  app.addHook('onRequest', async (request) => {
    requestStartTimes.set(request, process.hrtime.bigint());
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routeOptions.url ?? request.url;
    const method = request.method;
    const statusCode = String(reply.statusCode);

    httpRequestsTotal.inc({ method, route, status_code: statusCode });

    const startedAt = requestStartTimes.get(request);
    if (startedAt !== undefined) {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      httpRequestDurationSeconds.observe({ method, route, status_code: statusCode }, durationSeconds);
      requestStartTimes.delete(request);
    }

    if (reply.statusCode >= 500) {
      httpRequestErrorsTotal.inc({ method, route });
    }
  });
};
