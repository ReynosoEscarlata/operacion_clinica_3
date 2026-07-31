import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerXray } from '../src/xray-plugin.js';

// El daemon UDP no está corriendo en este test (127.0.0.1:2000 por
// default) -- `segment.close()` intenta enviar el segmento vía UDP
// connectionless, que no lanza sincrónicamente aunque nada esté
// escuchando. Este test verifica el wiring de anotaciones, no la entrega
// real al daemon (eso se verifica en LocalStack/AWS real, no en unit test).
describe('registerXray', () => {
  it('no registra nada si enabled=false (sin sidecar en dev por default)', async () => {
    const app = Fastify();
    await registerXray(app, {
      enabled: false,
      serviceName: 'test-service',
      sampling: { fixedTarget: 1, rate: 1 },
      getContext: () => ({}),
    });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ping' });
    expect(response.statusCode).toBe(200);
    // Sin el plugin registrado, request.segment nunca se decora.
    await app.close();
  });

  it('anota tenantId/requestId/route en el segmento cuando enabled=true', async () => {
    const app = Fastify();
    await registerXray(app, {
      enabled: true,
      serviceName: 'test-service',
      sampling: { fixedTarget: 1, rate: 1 },
      getContext: () => ({ tenantId: '11111111-1111-1111-1111-111111111111', requestId: 'req-1' }),
    });

    let capturedAnnotations: Record<string, unknown> = {};
    app.get('/v1/appointments/:id', async (request) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      capturedAnnotations = { ...(request.segment as any)?.annotations };
      return { ok: true };
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/v1/appointments/abc-123' });
    expect(response.statusCode).toBe(200);
    expect(capturedAnnotations.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(capturedAnnotations.requestId).toBe('req-1');
    expect(capturedAnnotations.service).toBe('test-service');

    await app.close();
  });
});
