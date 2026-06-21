import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from './config/prisma.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerMetricsMiddleware } from './middleware/metrics.js';
import { registerRequestId } from './middleware/request-id.js';
import { registerDoctorRoutes, type DoctorRoutesDeps } from './modules/doctors/index.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMetricsRoute } from './routes/metrics.js';

export interface BuildAppDeps {
  prisma?: PrismaClient;
  doctors?: DoctorRoutesDeps;
}

export const buildApp = async (deps: BuildAppDeps = {}): Promise<FastifyInstance> => {
  const prismaClient = deps.prisma ?? defaultPrisma;

  const app = Fastify({ logger: false });

  await app.register(cors);
  registerRequestId(app);
  registerMetricsMiddleware(app);
  app.setErrorHandler(errorHandler);

  await registerHealthRoute(app, prismaClient);
  await registerMetricsRoute(app);

  registerDoctorRoutes(app, deps.doctors);

  return app;
};
