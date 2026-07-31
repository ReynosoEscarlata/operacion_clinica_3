import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerRequestId } from '../../src/middleware/request-id.js';
import { getRequestId } from '../../src/lib/request-context.js';

const REQUEST_ID_HEADER = 'x-request-id';

describe('registerRequestId (gateway)', () => {
  it('genera un requestId nuevo si no llega ninguno, y lo devuelve en el header de respuesta', async () => {
    const app = Fastify();
    registerRequestId(app);
    app.get('/ping', async () => ({ requestId: getRequestId() }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/ping' });

    expect(response.headers[REQUEST_ID_HEADER]).toBeDefined();
    expect(response.json().requestId).toBe(response.headers[REQUEST_ID_HEADER]);
    await app.close();
  });

  it('reusa un x-request-id entrante en vez de generar uno nuevo (cierra docs/backlog-deuda.md ítem 8)', async () => {
    const app = Fastify();
    registerRequestId(app);
    app.get('/ping', async () => ({ requestId: getRequestId() }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { [REQUEST_ID_HEADER]: 'req-fijo-123' },
    });

    expect(response.headers[REQUEST_ID_HEADER]).toBe('req-fijo-123');
    expect(response.json().requestId).toBe('req-fijo-123');
    await app.close();
  });

  it('muta request.headers para que el mismo id se reenvíe aguas abajo sin tocar proxy.ts', async () => {
    const app = Fastify();
    registerRequestId(app);

    let observedHeader: string | string[] | undefined;
    app.get('/ping', async (request) => {
      observedHeader = request.headers[REQUEST_ID_HEADER];
      return { ok: true };
    });
    await app.ready();

    await app.inject({ method: 'GET', url: '/ping' });

    expect(observedHeader).toBeDefined();
    await app.close();
  });
});
