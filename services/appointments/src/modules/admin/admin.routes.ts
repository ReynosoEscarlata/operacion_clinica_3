import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { buildDeadLetterRepository, type DeadLetterRepository } from '../../lib/dead-letter.repository.js';
import { buildAppointmentRepository, type AppointmentRepository } from '../appointments/appointments.repository.js';
import { buildAdminController } from './admin.controller.js';
import { buildAdminRepository } from './admin.repository.js';
import { DeadLetterIdParams, RecentEventsQuery } from './admin.schemas.js';
import { buildAdminService } from './admin.service.js';

export interface AdminRoutesDeps {
  prisma?: PrismaClient;
  appointmentRepository?: AppointmentRepository;
  deadLetterRepository?: DeadLetterRepository;
}

// Todas protegidas en el gateway (requieren JWT de Admin/Staff) — ver
// gateway/src/middleware/verify-jwt.ts: nada bajo /v1/admin/* está en
// PUBLIC_ROUTES.
export const registerAdminRoutes = (app: FastifyInstance, deps: AdminRoutesDeps = {}): void => {
  const prismaClient = deps.prisma ?? defaultPrisma;
  const appointmentRepository = deps.appointmentRepository ?? buildAppointmentRepository(prismaClient);
  const deadLetterRepository = deps.deadLetterRepository ?? buildDeadLetterRepository(prismaClient);
  const adminRepository = buildAdminRepository(prismaClient, deadLetterRepository);
  const service = buildAdminService({ appointmentRepository, deadLetterRepository, adminRepository });
  const controller = buildAdminController(service);

  app.get('/v1/admin/dashboard', controller.getDashboard);
  app.get('/v1/admin/events', { schema: { querystring: RecentEventsQuery } }, controller.getRecentEvents);
  app.get('/v1/admin/dead-letter', controller.listDeadLetter);
  app.post(
    '/v1/admin/dead-letter/:id/retry',
    { schema: { params: DeadLetterIdParams } },
    controller.retryDeadLetter,
  );
  app.delete(
    '/v1/admin/dead-letter/:id',
    { schema: { params: DeadLetterIdParams } },
    controller.removeDeadLetter,
  );
};
