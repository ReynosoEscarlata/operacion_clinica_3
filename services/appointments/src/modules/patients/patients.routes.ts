import { requirePermission } from '@clinica/authz';
import type { FastifyInstance } from 'fastify';

import { buildHttpDoctorsClient, type DoctorsClient } from '../../clients/doctors-client.js';
import { buildHttpPaymentsClient, type PaymentsClient } from '../../clients/payments-client.js';
import { env } from '../../config/env.js';
import { prisma as defaultPrisma } from '../../config/prisma.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { buildPatientController } from './patients.controller.js';
import { buildPatientRepository, type PatientRepository } from './patients.repository.js';
import {
  CreatePatientBody,
  FindPatientByEmailQuery,
  ListPatientsQuery,
  PatientIdParams,
  UpdatePatientBody,
  type CreatePatientDto,
  type FindPatientByEmailQueryDto,
  type ListPatientsQueryDto,
  type PatientIdParamsDto,
  type UpdatePatientDto,
} from './patients.schemas.js';
import { buildPatientService } from './patients.service.js';

export interface PatientRoutesDeps {
  repository?: PatientRepository;
  paymentsClient?: PaymentsClient;
  doctorsClient?: DoctorsClient;
}

export const registerPatientRoutes = (app: FastifyInstance, deps: PatientRoutesDeps = {}): void => {
  const repository = deps.repository ?? buildPatientRepository(defaultPrisma);
  const paymentsClient = deps.paymentsClient ?? buildHttpPaymentsClient(env.PAYMENTS_SERVICE_URL);
  const doctorsClient = deps.doctorsClient ?? buildHttpDoctorsClient(env.DOCTORS_SERVICE_URL);
  const service = buildPatientService({ repository, paymentsClient, doctorsClient, logger: defaultLogger });
  const controller = buildPatientController(service);

  // patient:create excluye a clinic_owner/clinic_admin/doctor/
  // platform_support en la matriz de RFC-004 (solo platform_admin,
  // receptionist, y el paciente self-service) -- allowAnonymous, no public.
  app.post<{ Body: CreatePatientDto }>(
    '/v1/patients',
    {
      schema: { body: CreatePatientBody },
      config: { authz: { permission: 'patient:create', allowAnonymous: true } },
      preHandler: requirePermission('patient:create', { allowAnonymous: true }),
    },
    controller.create,
  );
  // patient:read no excluye a nadie en la matriz -- público sin matices.
  app.get<{ Querystring: FindPatientByEmailQueryDto }>(
    '/v1/patients/by-email',
    { schema: { querystring: FindPatientByEmailQuery }, config: { authz: { public: true } } },
    controller.findByEmail,
  );
  app.get<{ Params: PatientIdParamsDto }>(
    '/v1/patients/:id',
    { schema: { params: PatientIdParams }, config: { authz: { public: true } } },
    controller.getById,
  );
  app.patch<{ Params: PatientIdParamsDto; Body: UpdatePatientDto }>(
    '/v1/patients/:id',
    {
      schema: { params: PatientIdParams, body: UpdatePatientBody },
      config: { authz: { permission: 'patient:update' } },
      preHandler: requirePermission('patient:update'),
    },
    controller.update,
  );
  app.get<{ Querystring: ListPatientsQueryDto }>(
    '/v1/patients',
    {
      schema: { querystring: ListPatientsQuery },
      config: { authz: { permission: 'patient:list' } },
      preHandler: requirePermission('patient:list'),
    },
    controller.list,
  );
};
