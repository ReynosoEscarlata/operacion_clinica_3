import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { checkDatabase } from '../lib/health-check.js';

export const registerHealthRoute = async (
  app: FastifyInstance,
  prisma: PrismaClient,
): Promise<void> => {
  app.get('/health', async (request, reply) => {
    const database = await checkDatabase(prisma, request.log);
    reply.status(database === 'ok' ? 200 : 503);
    return { status: database === 'ok' ? 'ok' : 'error', service: 'doctors', checks: { database } };
  });
};
