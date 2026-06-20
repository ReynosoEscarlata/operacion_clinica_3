import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { stripe as defaultStripe } from '../../config/stripe.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { requireAdminAuth } from '../../middleware/admin-auth.js';
import { buildAppointmentRepository } from '../appointments/appointments.repository.js';
import { buildDefaultAppointmentService, type AppointmentService } from '../appointments/index.js';
import {
  buildAdminAppointmentsRepository,
  type AdminAppointmentsRepository,
} from './admin-appointments.repository.js';
import {
  buildAdminAppointmentsService,
  type AdminStripeClient,
} from './admin-appointments.service.js';
import { buildAdminAppointmentsController } from './admin-appointments.controller.js';
import {
  AdminAppointmentIdParams,
  AdminCancelAppointmentBody,
  AdminEventsQuery,
  AdminListAppointmentsQuery,
} from './admin-appointments.schemas.js';
import { buildDeadLetterController } from './dead-letter.controller.js';
import { buildDeadLetterService, type DeadLetterService } from './dead-letter.service.js';

export interface AdminRoutesDeps {
  deadLetterService?: DeadLetterService;
  appointmentsRepository?: AdminAppointmentsRepository;
  appointmentService?: AppointmentService;
  stripeClient?: AdminStripeClient;
}

export const registerAdminRoutes = (app: FastifyInstance, deps: AdminRoutesDeps = {}): void => {
  void app.register(async (adminScope) => {
    adminScope.addHook('preHandler', requireAdminAuth);

    const deadLetterService =
      deps.deadLetterService ?? buildDeadLetterService(buildAppointmentRepository(defaultPrisma), defaultLogger);
    const deadLetterController = buildDeadLetterController({ deadLetterService });

    const appointmentsRepository =
      deps.appointmentsRepository ?? buildAdminAppointmentsRepository(defaultPrisma);
    const appointmentService = deps.appointmentService ?? buildDefaultAppointmentService();
    const stripeClient = deps.stripeClient ?? defaultStripe;

    const appointmentsService = buildAdminAppointmentsService({
      repository: appointmentsRepository,
      appointmentService,
      stripeClient,
      logger: defaultLogger,
    });
    const appointmentsController = buildAdminAppointmentsController(appointmentsService);

    // --- Citas ---

    adminScope.get(
      '/api/admin/appointments',
      { schema: { querystring: AdminListAppointmentsQuery } },
      appointmentsController.list,
    );

    adminScope.get(
      '/api/admin/appointments/:id',
      { schema: { params: AdminAppointmentIdParams } },
      appointmentsController.getById,
    );

    adminScope.patch(
      '/api/admin/appointments/:id/cancel',
      { schema: { params: AdminAppointmentIdParams, body: AdminCancelAppointmentBody } },
      appointmentsController.cancel,
    );

    adminScope.patch(
      '/api/admin/appointments/:id/complete',
      { schema: { params: AdminAppointmentIdParams } },
      appointmentsController.complete,
    );

    adminScope.patch(
      '/api/admin/appointments/:id/no-show',
      { schema: { params: AdminAppointmentIdParams } },
      appointmentsController.markNoShow,
    );

    // --- Dashboard y debugging ---

    adminScope.get('/api/admin/dashboard', appointmentsController.dashboard);

    adminScope.get(
      '/api/admin/events',
      { schema: { querystring: AdminEventsQuery } },
      appointmentsController.events,
    );

    // --- Dead letter (jobs fallidos) ---

    adminScope.get(
      '/api/admin/dead-letter',
      {
        schema: {
          description: 'Listar jobs fallidos en dead-letter',
          response: {
            200: Type.Object({
              status: Type.Literal('ok'),
              data: Type.Array(
                Type.Object({
                  id: Type.String(),
                  queueName: Type.String(),
                  jobName: Type.String(),
                  data: Type.Unknown(),
                  failedReason: Type.String(),
                  attemptsMade: Type.Number(),
                  timestamp: Type.String(),
                }),
              ),
              count: Type.Number(),
            }),
          },
        },
      },
      (request, reply) => deadLetterController.getFailedJobs(request, reply),
    );

    const deadLetterJobParams = Type.Object({
      queueName: Type.String(),
      jobId: Type.String(),
    });

    adminScope.post(
      '/api/admin/dead-letter/:queueName/:jobId/retry',
      {
        schema: {
          description: 'Reintentar un job fallido',
          params: deadLetterJobParams,
          response: {
            200: Type.Object({ status: Type.Literal('ok'), message: Type.String() }),
          },
        },
      },
      (request: FastifyRequest<{ Params: { jobId: string; queueName: string } }>, reply) =>
        deadLetterController.retryJob(request, reply),
    );

    adminScope.delete(
      '/api/admin/dead-letter/:queueName/:jobId',
      {
        schema: {
          description: 'Remover un job fallido',
          params: deadLetterJobParams,
          response: {
            200: Type.Object({ status: Type.Literal('ok'), message: Type.String() }),
          },
        },
      },
      (request: FastifyRequest<{ Params: { jobId: string; queueName: string } }>, reply) =>
        deadLetterController.removeJob(request, reply),
    );
  });
};
