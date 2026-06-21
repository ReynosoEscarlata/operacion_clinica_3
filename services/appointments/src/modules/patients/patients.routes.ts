import type { FastifyInstance } from 'fastify';

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
} from './patients.schemas.js';
import { buildPatientService } from './patients.service.js';

export interface PatientRoutesDeps {
  repository?: PatientRepository;
  paymentsClient?: PaymentsClient;
}

export const registerPatientRoutes = (app: FastifyInstance, deps: PatientRoutesDeps = {}): void => {
  const repository = deps.repository ?? buildPatientRepository(defaultPrisma);
  const paymentsClient = deps.paymentsClient ?? buildHttpPaymentsClient(env.PAYMENTS_SERVICE_URL);
  const service = buildPatientService({ repository, paymentsClient, logger: defaultLogger });
  const controller = buildPatientController(service);

  app.post('/v1/patients', { schema: { body: CreatePatientBody } }, controller.create);
  app.get(
    '/v1/patients/by-email',
    { schema: { querystring: FindPatientByEmailQuery } },
    controller.findByEmail,
  );
  app.get('/v1/patients/:id', { schema: { params: PatientIdParams } }, controller.getById);
  app.patch(
    '/v1/patients/:id',
    { schema: { params: PatientIdParams, body: UpdatePatientBody } },
    controller.update,
  );
  app.get('/v1/patients', { schema: { querystring: ListPatientsQuery } }, controller.list);
};
