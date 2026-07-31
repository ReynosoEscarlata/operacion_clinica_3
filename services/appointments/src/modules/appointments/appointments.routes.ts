import { requirePermission } from '@clinica/authz';
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
  type AppointmentIdParamsDto,
  type CancelAppointmentDto,
  type CreateAppointmentDto,
  type ListAppointmentsQueryDto,
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

  // Públicas por posesión de UUID (ver gateway/src/middleware/verify-jwt.ts)
  // -- el paciente no tiene cuenta (RFC-001). appointment:create/cancel usan
  // allowAnonymous en vez de config.authz.public porque la matriz de
  // RFC-004 excluye explícitamente a algún rol autenticado (doctor en
  // create, platform_support en cancel) -- `public` liso desactivaría ese
  // chequeo también para esos roles. appointment:read no excluye a nadie,
  // así que sí puede ser público sin matices.
  app.post<{ Body: CreateAppointmentDto }>(
    '/v1/appointments',
    {
      schema: { body: CreateAppointmentBody },
      config: { authz: { permission: 'appointment:create', allowAnonymous: true } },
      preHandler: requirePermission('appointment:create', { allowAnonymous: true }),
    },
    controller.create,
  );
  app.get<{ Params: AppointmentIdParamsDto }>(
    '/v1/appointments/:id',
    { schema: { params: AppointmentIdParams }, config: { authz: { public: true } } },
    controller.getById,
  );
  app.patch<{ Params: AppointmentIdParamsDto; Body: CancelAppointmentDto }>(
    '/v1/appointments/:id/cancel',
    {
      schema: { params: AppointmentIdParams, body: CancelAppointmentBody },
      config: { authz: { permission: 'appointment:cancel', allowAnonymous: true } },
      preHandler: requirePermission('appointment:cancel', { allowAnonymous: true }),
    },
    controller.cancel,
  );

  // Protegidas en el gateway (requieren JWT) y ahora también por
  // requirePermission() -- el filtro ABAC de propiedad del doctor
  // (appointment.doctorId === actor.doctorId) vive en el repositorio/
  // state-machine, no aquí (ver lib/abac.ts).
  app.get<{ Querystring: ListAppointmentsQueryDto }>(
    '/v1/appointments',
    {
      schema: { querystring: ListAppointmentsQuery },
      config: { authz: { permission: 'appointment:list' } },
      preHandler: requirePermission('appointment:list'),
    },
    controller.list,
  );
  app.patch<{ Params: AppointmentIdParamsDto }>(
    '/v1/appointments/:id/complete',
    {
      schema: { params: AppointmentIdParams },
      config: { authz: { permission: 'appointment:complete' } },
      preHandler: requirePermission('appointment:complete'),
    },
    controller.complete,
  );
  app.patch<{ Params: AppointmentIdParamsDto }>(
    '/v1/appointments/:id/no-show',
    {
      schema: { params: AppointmentIdParams },
      config: { authz: { permission: 'appointment:mark_no_show' } },
      preHandler: requirePermission('appointment:mark_no_show'),
    },
    controller.markNoShow,
  );
};
