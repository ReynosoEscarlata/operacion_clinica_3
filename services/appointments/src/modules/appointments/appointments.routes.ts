import type { FastifyInstance } from 'fastify';

import { buildHttpDoctorsClient, type DoctorsClient } from '../../clients/doctors-client.js';
import { buildHttpPaymentsClient, type PaymentsClient } from '../../clients/payments-client.js';
import { env } from '../../config/env.js';
import { prisma as defaultPrisma } from '../../config/prisma.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { buildPatientRepository, type PatientRepository } from '../patients/patients.repository.js';
import { enqueueAppointmentExpiration } from '../../queues/jobs/expiration.job.js';
import { enqueueAppointmentReminder } from '../../queues/jobs/reminder.job.js';
import { buildAppointmentController } from './appointments.controller.js';
import { buildAppointmentRepository, type AppointmentRepository } from './appointments.repository.js';
import {
  AppointmentIdParams,
  CancelAppointmentBody,
  CreateAppointmentBody,
  ListAppointmentsQuery,
} from './appointments.schemas.js';
import { buildAppointmentService, type AppointmentService } from './appointments.service.js';
import { buildStateMachine, type AppointmentStateMachine } from './state-machine.js';

export interface AppointmentRoutesDeps {
  repository?: AppointmentRepository;
  patientRepository?: PatientRepository;
  doctorsClient?: DoctorsClient;
  stateMachine?: AppointmentStateMachine;
  paymentsClient?: PaymentsClient;
  enqueueExpiration?: (appointmentId: string, requestId?: string) => Promise<void>;
  enqueueReminder?: (appointmentId: string, dateTime: Date, requestId?: string) => Promise<void>;
}

// Reusado por los workers de colas (expiración/recordatorio/no-show) para
// no duplicar el wiring de dependencias del AppointmentService.
export const buildDefaultAppointmentService = (
  deps: AppointmentRoutesDeps = {},
): AppointmentService => {
  const repository = deps.repository ?? buildAppointmentRepository(defaultPrisma);
  const patientRepository = deps.patientRepository ?? buildPatientRepository(defaultPrisma);
  const doctorsClient = deps.doctorsClient ?? buildHttpDoctorsClient(env.DOCTORS_SERVICE_URL);
  const stateMachine = deps.stateMachine ?? buildStateMachine(defaultPrisma, defaultLogger);
  const paymentsClient = deps.paymentsClient ?? buildHttpPaymentsClient(env.PAYMENTS_SERVICE_URL);
  const enqueueExpiration = deps.enqueueExpiration ?? enqueueAppointmentExpiration;
  const enqueueReminder = deps.enqueueReminder ?? enqueueAppointmentReminder;

  return buildAppointmentService({
    repository,
    patientRepository,
    doctorsClient,
    stateMachine,
    paymentsClient,
    enqueueExpiration,
    enqueueReminder,
    logger: defaultLogger,
  });
};

export const registerAppointmentRoutes = (
  app: FastifyInstance,
  deps: AppointmentRoutesDeps = {},
): void => {
  const service = buildDefaultAppointmentService(deps);
  const controller = buildAppointmentController(service);

  // Públicas (ver gateway/src/middleware/verify-jwt.ts): el paciente no
  // tiene cuenta, se identifica por posesión del UUID de la cita.
  app.post('/v1/appointments', { schema: { body: CreateAppointmentBody } }, controller.create);
  app.get('/v1/appointments/:id', { schema: { params: AppointmentIdParams } }, controller.getById);
  app.patch(
    '/v1/appointments/:id/cancel',
    { schema: { params: AppointmentIdParams, body: CancelAppointmentBody } },
    controller.cancel,
  );

  // Protegidas en el gateway (requieren JWT de Admin/Staff).
  app.get('/v1/appointments', { schema: { querystring: ListAppointmentsQuery } }, controller.list);
  app.patch(
    '/v1/appointments/:id/complete',
    { schema: { params: AppointmentIdParams } },
    controller.complete,
  );
  app.patch(
    '/v1/appointments/:id/no-show',
    { schema: { params: AppointmentIdParams } },
    controller.markNoShow,
  );
};
