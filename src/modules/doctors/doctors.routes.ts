import type { FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { buildDoctorController } from './doctors.controller.js';
import { buildDoctorRepository, type DoctorRepository } from './doctors.repository.js';
import {
  CreateDoctorBody,
  DoctorIdParams,
  GetSlotsQuery,
  SetAvailabilityBody,
} from './doctors.schemas.js';
import { buildDoctorService } from './doctors.service.js';

export interface DoctorRoutesDeps {
  repository?: DoctorRepository;
}

export const registerDoctorRoutes = (app: FastifyInstance, deps: DoctorRoutesDeps = {}): void => {
  const repository = deps.repository ?? buildDoctorRepository(defaultPrisma);
  const service = buildDoctorService({ repository, logger: defaultLogger });
  const controller = buildDoctorController(service);

  app.post('/api/doctors', { schema: { body: CreateDoctorBody } }, controller.create);

  app.get('/api/doctors/:id', { schema: { params: DoctorIdParams } }, controller.getById);

  app.get('/api/doctors', controller.listAll);

  app.post(
    '/api/doctors/:id/availability',
    { schema: { params: DoctorIdParams, body: SetAvailabilityBody } },
    controller.setAvailability,
  );

  app.get(
    '/api/doctors/:id/slots',
    { schema: { params: DoctorIdParams, querystring: GetSlotsQuery } },
    controller.getSlots,
  );
};
