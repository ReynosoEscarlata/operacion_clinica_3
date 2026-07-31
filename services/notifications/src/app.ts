import { registerAuthzEnforcement } from '@clinica/authz';
import { registerXray } from '@clinica/observability';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';

import { env } from './config/env.js';
import { prisma as defaultPrisma } from './config/prisma.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerAuthzContext } from './middleware/authz-context.js';
import { registerMetricsMiddleware } from './middleware/metrics.js';
import { registerRequestId } from './middleware/request-id.js';
import { registerTenantContext } from './middleware/tenant-context.js';
import { getRequestId, setTraceId } from './lib/request-context.js';
import { getTenantId } from './lib/tenant-context.js';
import {
  registerNotificationsRoutes,
  type NotificationsRoutesDeps,
} from './modules/notifications/index.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMetricsRoute } from './routes/metrics.js';

export interface BuildAppDeps {
  prisma?: PrismaClient;
  notifications?: NotificationsRoutesDeps;
}

export const buildApp = async (deps: BuildAppDeps = {}): Promise<FastifyInstance> => {
  const prismaClient = deps.prisma ?? defaultPrisma;

  const app = Fastify({ logger: false });

  await app.register(cors);
  registerRequestId(app);
  registerTenantContext(app);
  // Después de request-id/tenant-context (ADR-017): el segmento anota el
  // tenantId/requestId ya resueltos por esos hooks, y deja el trace header
  // en request-context.ts para que doctors-client.ts/payments-client.ts lo
  // propaguen en sus fetch síncronos.
  await registerXray(app, {
    enabled: env.XRAY_ENABLED,
    serviceName: 'notifications',
    sampling: { fixedTarget: 1, rate: env.XRAY_SAMPLING_RATE },
    getContext: () => ({ tenantId: getTenantId(), requestId: getRequestId() }),
    onTraceHeader: setTraceId,
  });
  registerAuthzContext(app);
  registerAuthzEnforcement(app);
  registerMetricsMiddleware(app);
  app.setErrorHandler(errorHandler);

  await registerHealthRoute(app, prismaClient);
  await registerMetricsRoute(app);

  registerNotificationsRoutes(app, deps.notifications);

  return app;
};
