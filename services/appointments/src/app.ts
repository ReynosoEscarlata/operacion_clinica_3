import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from './config/prisma.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerMetricsMiddleware } from './middleware/metrics.js';
import { registerRequestId } from './middleware/request-id.js';
import { registerAdminRoutes, type AdminRoutesDeps } from './modules/admin/index.js';
import { registerAppointmentRoutes, type AppointmentRoutesDeps } from './modules/appointments/index.js';
import { registerPatientRoutes, type PatientRoutesDeps } from './modules/patients/index.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMetricsRoute } from './routes/metrics.js';

export interface BuildAppDeps {
  prisma?: PrismaClient;
  appointments?: AppointmentRoutesDeps;
  patients?: PatientRoutesDeps;
  admin?: AdminRoutesDeps;
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

  registerPatientRoutes(app, deps.patients);
  registerAppointmentRoutes(app, deps.appointments);
  registerAdminRoutes(app, deps.admin);

  return app;
};
