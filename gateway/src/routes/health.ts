import type { FastifyInstance } from 'fastify';

export const registerHealthRoute = async (app: FastifyInstance): Promise<void> => {
  app.get('/healthz', async () => ({ status: 'ok', service: 'gateway' }));
};
