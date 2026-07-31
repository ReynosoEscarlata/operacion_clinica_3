import { describe, expect, it, vi } from 'vitest';

import { buildRequestMetricsEmf, emitRequestMetrics } from '../src/emf.js';

describe('buildRequestMetricsEmf', () => {
  it('arma el shape EMF con dimensiones [Service, Environment] únicamente', () => {
    const doc = buildRequestMetricsEmf({
      namespace: 'Clinica',
      service: 'appointments',
      environment: 'dev',
      route: '/v1/appointments/:id',
      method: 'GET',
      statusCode: 200,
      durationMs: 42,
    });

    expect(doc._aws.CloudWatchMetrics).toHaveLength(1);
    expect(doc._aws.CloudWatchMetrics[0]?.Namespace).toBe('Clinica');
    expect(doc._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['Service', 'Environment']]);
    expect(doc._aws.CloudWatchMetrics[0]?.Metrics.map((m) => m.Name)).toEqual([
      'RequestCount',
      'RequestLatency',
      'ErrorCount',
    ]);
    expect(doc.RequestCount).toBe(1);
    expect(doc.RequestLatency).toBe(42);
    expect(doc.ErrorCount).toBe(0);
  });

  it('marca ErrorCount=1 cuando statusCode >= 500', () => {
    const doc = buildRequestMetricsEmf({
      namespace: 'Clinica',
      service: 'appointments',
      environment: 'dev',
      route: '/v1/appointments',
      method: 'POST',
      statusCode: 502,
      durationMs: 10,
    });

    expect(doc.ErrorCount).toBe(1);
  });

  it('no marca ErrorCount para un 4xx (error del cliente, no del servicio)', () => {
    const doc = buildRequestMetricsEmf({
      namespace: 'Clinica',
      service: 'appointments',
      environment: 'dev',
      route: '/v1/appointments/:id',
      method: 'GET',
      statusCode: 404,
      durationMs: 5,
    });

    expect(doc.ErrorCount).toBe(0);
  });

  it('omite tenantId/requestId/traceId cuando no se proveen (nunca null explícito en la línea)', () => {
    const doc = buildRequestMetricsEmf({
      namespace: 'Clinica',
      service: 'appointments',
      environment: 'dev',
      route: '/v1/appointments',
      method: 'GET',
      statusCode: 200,
      durationMs: 1,
    });

    expect(doc).not.toHaveProperty('tenantId');
    expect(doc).not.toHaveProperty('requestId');
    expect(doc).not.toHaveProperty('traceId');
  });

  it('incluye tenantId/requestId/traceId como propiedades no-dimensionales cuando se proveen', () => {
    const doc = buildRequestMetricsEmf({
      namespace: 'Clinica',
      service: 'appointments',
      environment: 'dev',
      route: '/v1/appointments/:id',
      method: 'GET',
      statusCode: 200,
      durationMs: 1,
      tenantId: '11111111-1111-1111-1111-111111111111',
      requestId: 'req-1',
      traceId: 'trace-1',
    });

    expect(doc.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(doc.requestId).toBe('req-1');
    expect(doc.traceId).toBe('trace-1');
  });
});

describe('emitRequestMetrics', () => {
  it('loguea el documento EMF vía logger.info con el mensaje emf_request_metrics', () => {
    const logger = { info: vi.fn() };

    emitRequestMetrics(logger as never, {
      namespace: 'Clinica',
      service: 'appointments',
      environment: 'dev',
      route: '/v1/appointments/:id',
      method: 'GET',
      statusCode: 200,
      durationMs: 7,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ Service: 'appointments', RequestCount: 1 }),
      'emf_request_metrics',
    );
  });
});
