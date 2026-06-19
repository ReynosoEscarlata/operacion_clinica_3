import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from './config/prisma.js';
import { redis as defaultRedis } from './config/redis.js';
import { checkDatabase, checkRedis } from './lib/health-check.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerRequestId } from './middleware/request-id.js';
import { registerAppointmentRoutes, type AppointmentRoutesDeps } from './modules/appointments/index.js';
import { registerDoctorRoutes, type DoctorRoutesDeps } from './modules/doctors/index.js';
import { registerPatientRoutes, type PatientRoutesDeps } from './modules/patients/index.js';

export interface BuildAppDeps {
  prisma?: Parameters<typeof checkDatabase>[0];
  redis?: Parameters<typeof checkRedis>[0];
  patients?: PatientRoutesDeps;
  doctors?: DoctorRoutesDeps;
  appointments?: AppointmentRoutesDeps;
}

export const buildApp = (deps: BuildAppDeps = {}): FastifyInstance => {
  const prismaClient = deps.prisma ?? defaultPrisma;
  const redisClient = deps.redis ?? defaultRedis;

  const app = Fastify({ logger: false });

  app.register(cors);
  registerRequestId(app);
  app.setErrorHandler(errorHandler);

  registerPatientRoutes(app, deps.patients);
  registerDoctorRoutes(app, deps.doctors);
  registerAppointmentRoutes(app, deps.appointments);

  app.get('/health', async (request, reply) => {
    const [database, redisStatus] = await Promise.all([
      checkDatabase(prismaClient, request.log),
      checkRedis(redisClient, request.log),
    ]);

    const healthy = database === 'ok' && redisStatus === 'ok';

    reply.status(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'error', checks: { database, redis: redisStatus } };
  });

  return app;
};
