import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '@clinica/observability';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { logger } from '../lib/logger.js';
import { requestContextStorage } from '../lib/request-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

// Fase 6 (ADR-017): el gateway nunca generaba ni reenviaba un x-request-id
// -- los 5 servicios ya leen uno entrante como propio (fallback a un UUID
// nuevo si no llega), así que una request perdía su correlación exacta en
// el salto gateway→servicio (cada lado generaba el suyo). Cierra
// docs/backlog-deuda.md ítem 8.
export const registerRequestId = (app: FastifyInstance): void => {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const incoming = request.headers[REQUEST_ID_HEADER];
    const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

    request.requestId = requestId;
    request.log = logger.child({ requestId });
    reply.header(REQUEST_ID_HEADER, requestId);

    // Mutación intencional: `gateway/src/routes/proxy.ts`'s
    // `buildInternalHeaders` hace `...headers` primero al armar los headers
    // que reenvía al servicio upstream -- alcanza con que el id ya esté acá
    // para que se reenvíe, sin tocar proxy.ts.
    request.headers[REQUEST_ID_HEADER] = requestId;

    requestContextStorage.enterWith({ requestId });
  });
};
