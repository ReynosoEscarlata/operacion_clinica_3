import type { FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { stripe as defaultStripe } from '../../config/stripe.js';
import { env } from '../../config/env.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { requireAdminAuth } from '../../middleware/admin-auth.js';
import { enqueueAppointmentExpiration } from '../../queues/jobs/expiration.job.js';
import { buildDoctorRepository, type DoctorRepository } from '../doctors/doctors.repository.js';
import { buildPatientRepository, type PatientRepository } from '../patients/patients.repository.js';
import { buildAppointmentController } from './appointments.controller.js';
import { buildAppointmentRepository, type AppointmentRepository } from './appointments.repository.js';
import {
  AppointmentIdParams,
  CancelAppointmentBody,
  CreateAppointmentBody,
  ListAppointmentsQuery,
} from './appointments.schemas.js';
import { buildAppointmentService, type StripeAppointmentsClient } from './appointments.service.js';
import { buildStateMachine, type AppointmentStateMachine } from './state-machine.js';

export interface AppointmentRoutesDeps {
  repository?: AppointmentRepository;
  patientRepository?: PatientRepository;
  doctorRepository?: DoctorRepository;
  stateMachine?: AppointmentStateMachine;
  stripeClient?: StripeAppointmentsClient;
  enqueueExpiration?: (appointmentId: string, requestId?: string) => Promise<void>;
}

export const registerAppointmentRoutes = (
  app: FastifyInstance,
  deps: AppointmentRoutesDeps = {},
): void => {
  const repository = deps.repository ?? buildAppointmentRepository(defaultPrisma);
  const patientRepository = deps.patientRepository ?? buildPatientRepository(defaultPrisma);
  const doctorRepository = deps.doctorRepository ?? buildDoctorRepository(defaultPrisma);
  const stateMachine = deps.stateMachine ?? buildStateMachine(defaultPrisma, defaultLogger);
  const stripeClient = deps.stripeClient ?? defaultStripe;
  const enqueueExpiration = deps.enqueueExpiration ?? enqueueAppointmentExpiration;

  const service = buildAppointmentService({
    repository,
    patientRepository,
    doctorRepository,
    stateMachine,
    stripeClient,
    enqueueExpiration,
    logger: defaultLogger,
  });
  const controller = buildAppointmentController(service, env.ADMIN_API_KEY);

  app.post('/api/appointments', { schema: { body: CreateAppointmentBody } }, controller.create);

  app.get(
    '/api/appointments/:id',
    { schema: { params: AppointmentIdParams } },
    controller.getById,
  );

  app.get(
    '/api/appointments',
    { schema: { querystring: ListAppointmentsQuery } },
    controller.list,
  );

  app.patch(
    '/api/appointments/:id/cancel',
    { schema: { params: AppointmentIdParams, body: CancelAppointmentBody } },
    controller.cancel,
  );

  void app.register(async (adminScope) => {
    adminScope.addHook('preHandler', requireAdminAuth);

    adminScope.patch(
      '/api/appointments/:id/complete',
      { schema: { params: AppointmentIdParams } },
      controller.complete,
    );

    adminScope.patch(
      '/api/appointments/:id/no-show',
      { schema: { params: AppointmentIdParams } },
      controller.markNoShow,
    );
  });
};
