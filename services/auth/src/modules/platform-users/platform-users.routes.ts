import { requirePermission } from '@clinica/authz';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { buildPlatformUsersController } from './platform-users.controller.js';
import { buildPlatformUsersRepository, type PlatformUsersRepository } from './platform-users.repository.js';
import { buildPlatformUsersService } from './platform-users.service.js';

export interface PlatformUsersRoutesDeps {
  prisma?: PrismaClient;
  repository?: PlatformUsersRepository;
}

// Prefijo /v1/platform-users, deliberadamente disjunto de /v1/users (RFC-004:
// dos planos de autorización) -- mismo criterio que /v1/platform en
// Appointments. Exento de tenant-context.ts (ver ese archivo).
export const registerPlatformUsersRoutes = (app: FastifyInstance, deps: PlatformUsersRoutesDeps = {}): void => {
  const prismaClient = deps.prisma ?? defaultPrisma;
  const repository = deps.repository ?? buildPlatformUsersRepository(prismaClient);
  const service = buildPlatformUsersService({ repository });
  const controller = buildPlatformUsersController(service);

  app.get(
    '/v1/platform-users/active',
    {
      config: { authz: { permission: 'platform_dashboard:read' } },
      preHandler: requirePermission('platform_dashboard:read'),
    },
    controller.getActive,
  );
};
