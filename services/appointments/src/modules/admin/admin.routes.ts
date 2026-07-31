import { requirePermission } from '@clinica/authz';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { buildDeadLetterRepository, type DeadLetterRepository } from '../../lib/dead-letter.repository.js';
import { buildAppointmentRepository, type AppointmentRepository } from '../appointments/appointments.repository.js';
import { buildAdminController } from './admin.controller.js';
import { buildAdminRepository } from './admin.repository.js';
import {
  DeadLetterIdParams,
  RecentEventsQuery,
  type DeadLetterIdParamsDto,
  type RecentEventsQueryDto,
} from './admin.schemas.js';
import { buildAdminService } from './admin.service.js';

export interface AdminRoutesDeps {
  prisma?: PrismaClient;
  appointmentRepository?: AppointmentRepository;
  deadLetterRepository?: DeadLetterRepository;
}

// Todas protegidas en el gateway (requieren JWT) y ahora también por
// requirePermission() -- ver gateway/src/middleware/verify-jwt.ts: nada
// bajo /v1/admin/* está en PUBLIC_ROUTES.
export const registerAdminRoutes = (app: FastifyInstance, deps: AdminRoutesDeps = {}): void => {
  const prismaClient = deps.prisma ?? defaultPrisma;
  const appointmentRepository = deps.appointmentRepository ?? buildAppointmentRepository(prismaClient);
  const deadLetterRepository = deps.deadLetterRepository ?? buildDeadLetterRepository(prismaClient);
  const adminRepository = buildAdminRepository(prismaClient, deadLetterRepository);
  const service = buildAdminService({ appointmentRepository, deadLetterRepository, adminRepository });
  const controller = buildAdminController(service);

  app.get(
    '/v1/admin/dashboard',
    { config: { authz: { permission: 'dashboard:read' } }, preHandler: requirePermission('dashboard:read') },
    controller.getDashboard,
  );
  app.get<{ Querystring: RecentEventsQueryDto }>(
    '/v1/admin/events',
    {
      schema: { querystring: RecentEventsQuery },
      config: { authz: { permission: 'audit:read' } },
      preHandler: requirePermission('audit:read'),
    },
    controller.getRecentEvents,
  );
  app.get(
    '/v1/admin/dead-letter',
    {
      config: { authz: { permission: 'dead_letter:read' } },
      preHandler: requirePermission('dead_letter:read'),
    },
    controller.listDeadLetter,
  );
  app.post<{ Params: DeadLetterIdParamsDto }>(
    '/v1/admin/dead-letter/:id/retry',
    {
      schema: { params: DeadLetterIdParams },
      config: { authz: { permission: 'dead_letter:retry' } },
      preHandler: requirePermission('dead_letter:retry'),
    },
    controller.retryDeadLetter,
  );
  app.delete<{ Params: DeadLetterIdParamsDto }>(
    '/v1/admin/dead-letter/:id',
    {
      schema: { params: DeadLetterIdParams },
      config: { authz: { permission: 'dead_letter:remove' } },
      preHandler: requirePermission('dead_letter:remove'),
    },
    controller.removeDeadLetter,
  );
};
