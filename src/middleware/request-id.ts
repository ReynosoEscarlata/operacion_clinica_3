import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { REQUEST_ID_HEADER } from '../lib/constants.js';
import { logger } from '../lib/logger.js';
import { requestContextStorage } from '../lib/request-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

export const registerRequestId = (app: FastifyInstance): void => {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const incoming = request.headers[REQUEST_ID_HEADER];
    const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

    request.requestId = requestId;
    request.log = logger.child({ requestId });
    reply.header(REQUEST_ID_HEADER, requestId);

    // Habilita el mixin de pino (ver lib/logger.ts) para que cualquier
    // logger.* invocado durante esta request -aunque use el logger global,
    // no request.log- incluya requestId sin tener que pasarlo manualmente.
    requestContextStorage.enterWith({ requestId });
  });
};
