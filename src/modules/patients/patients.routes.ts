import type { FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { stripe as defaultStripe } from '../../config/stripe.js';
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
import { buildPatientService, type StripeCustomersClient } from './patients.service.js';

export interface PatientRoutesDeps {
  repository?: PatientRepository;
  stripeClient?: StripeCustomersClient;
}

export const registerPatientRoutes = (app: FastifyInstance, deps: PatientRoutesDeps = {}): void => {
  const repository = deps.repository ?? buildPatientRepository(defaultPrisma);
  const stripeClient = deps.stripeClient ?? defaultStripe;
  const service = buildPatientService({ repository, stripeClient, logger: defaultLogger });
  const controller = buildPatientController(service);

  app.post('/api/patients', { schema: { body: CreatePatientBody } }, controller.create);

  app.get(
    '/api/patients/by-email',
    { schema: { querystring: FindPatientByEmailQuery } },
    controller.findByEmail,
  );

  app.get('/api/patients/:id', { schema: { params: PatientIdParams } }, controller.getById);

  app.patch(
    '/api/patients/:id',
    { schema: { params: PatientIdParams, body: UpdatePatientBody } },
    controller.update,
  );

  app.get('/api/patients', { schema: { querystring: ListPatientsQuery } }, controller.list);
};
