import { requirePermission } from '@clinica/authz';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { buildPlatformController } from './platform.controller.js';
import { buildPlatformRepository, type PlatformRepository } from './platform.repository.js';
import { buildPlatformService } from './platform.service.js';

export interface PlatformRoutesDeps {
  prisma?: PrismaClient;
  repository?: PlatformRepository;
}

// Prefijo /v1/platform, deliberadamente disjunto de /v1/admin (RFC-002: "el
// gateway agrega" fue rechazado; el dueño del endpoint cross-tenant es
// Appointments) -- son dos planos de autorización distintos (RFC-004), y
// mezclarlos bajo el mismo prefijo es cómo se cuelan bugs de aislamiento
// (el matching por prefijo de @fastify/http-proxy con prefijos anidados es
// fuente de sorpresas). Exento de tenant-context.ts (ver ese archivo).
export const registerPlatformRoutes = (app: FastifyInstance, deps: PlatformRoutesDeps = {}): void => {
  const prismaClient = deps.prisma ?? defaultPrisma;
  const repository = deps.repository ?? buildPlatformRepository(prismaClient);
  const service = buildPlatformService({ repository });
  const controller = buildPlatformController(service);

  app.get(
    '/v1/platform/dashboard',
    {
      config: { authz: { permission: 'platform_dashboard:read' } },
      preHandler: requirePermission('platform_dashboard:read'),
    },
    controller.getDashboard,
  );
  app.get(
    '/v1/platform/metrics',
    {
      config: { authz: { permission: 'platform_dashboard:read' } },
      preHandler: requirePermission('platform_dashboard:read'),
    },
    controller.getMetrics,
  );
};
