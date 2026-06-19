import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { errorHandler } from './middleware/error-handler.js';
import { registerRequestId } from './middleware/request-id.js';

export const buildApp = (): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.register(cors);
  registerRequestId(app);
  app.setErrorHandler(errorHandler);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
};
