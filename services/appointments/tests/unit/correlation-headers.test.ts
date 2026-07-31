import { XRAY_TRACE_HEADER } from '@clinica/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildHttpDoctorsClient } from '../../src/clients/doctors-client.js';
import { buildHttpPaymentsClient } from '../../src/clients/payments-client.js';
import { REQUEST_ID_HEADER } from '../../src/lib/constants.js';
import { requestContextStorage } from '../../src/lib/request-context.js';

// La propagación de correlación (requestId + traza de X-Ray) hacia Doctors/
// Payments es la última pieza de ADR-017 sin cubrir: sin este test, un
// refactor futuro de correlationHeaders() podría dejar de mandar el header
// de traza sin que ninguna suite lo note (los tests de integración mockean
// fetch a nivel de respuesta, no inspeccionan los headers salientes).
describe('correlationHeaders (doctors-client, payments-client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('doctors-client propaga x-request-id y X-Amzn-Trace-Id cuando ambos están en contexto', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ slots: [] }), { status: 200 }));
    const client = buildHttpDoctorsClient('http://doctors.local');

    await requestContextStorage.run(
      { requestId: 'req-1', ip: '127.0.0.1', userAgent: null, traceId: 'Root=1-a;Parent=b;Sampled=1' },
      () => client.getAvailableSlots('doctor-1', '2026-08-01'),
    );

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers[REQUEST_ID_HEADER]).toBe('req-1');
    expect(headers[XRAY_TRACE_HEADER]).toBe('Root=1-a;Parent=b;Sampled=1');
  });

  it('doctors-client omite X-Amzn-Trace-Id cuando no hay segmento de X-Ray en contexto (XRAY_ENABLED=false)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ slots: [] }), { status: 200 }));
    const client = buildHttpDoctorsClient('http://doctors.local');

    await requestContextStorage.run({ requestId: 'req-1', ip: '127.0.0.1', userAgent: null }, () =>
      client.getAvailableSlots('doctor-1', '2026-08-01'),
    );

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers[REQUEST_ID_HEADER]).toBe('req-1');
    expect(headers[XRAY_TRACE_HEADER]).toBeUndefined();
  });

  it('payments-client propaga X-Amzn-Trace-Id junto con el resto de los headers de correlación/tenant', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'pi_1', clientSecret: 'secret' }), { status: 200 }));
    const client = buildHttpPaymentsClient('http://payments.local');

    await requestContextStorage.run(
      { requestId: 'req-2', ip: '127.0.0.1', userAgent: null, traceId: 'Root=1-c;Parent=d;Sampled=0' },
      () => client.createPaymentIntent('appt-1', 1000, null),
    );

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers[REQUEST_ID_HEADER]).toBe('req-2');
    expect(headers[XRAY_TRACE_HEADER]).toBe('Root=1-c;Parent=d;Sampled=0');
  });
});
