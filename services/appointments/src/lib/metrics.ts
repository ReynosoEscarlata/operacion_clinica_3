import client from 'prom-client';

export const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

const LABEL_NAMES = ['method', 'route', 'status_code'] as const;

// Métricas RED (Rate/Errors/Duration) por endpoint — PLAN.md Fase 4.
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requests HTTP, por método/ruta/status',
  labelNames: LABEL_NAMES,
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duración de requests HTTP en segundos, por método/ruta/status',
  labelNames: LABEL_NAMES,
  registers: [metricsRegistry],
});

export const httpRequestErrorsTotal = new client.Counter({
  name: 'http_request_errors_total',
  help: 'Total de requests HTTP con status >= 500, por método/ruta',
  labelNames: ['method', 'route'] as const,
  registers: [metricsRegistry],
});
