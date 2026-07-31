import { requirePermission } from '@clinica/authz';
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
  type CreateDoctorDto,
  type DoctorIdParamsDto,
  type GetSlotsQueryDto,
  type SetAvailabilityDto,
} from './doctors.schemas.js';
import { buildDoctorService } from './doctors.service.js';

export interface DoctorRoutesDeps {
  repository?: DoctorRepository;
}

export const registerDoctorRoutes = (app: FastifyInstance, deps: DoctorRoutesDeps = {}): void => {
  const repository = deps.repository ?? buildDoctorRepository(defaultPrisma);
  const service = buildDoctorService({ repository, logger: defaultLogger });
  const controller = buildDoctorController(service);

  app.post<{ Body: CreateDoctorDto }>(
    '/v1/doctors',
    {
      schema: { body: CreateDoctorBody },
      config: { authz: { permission: 'doctor:create' } },
      preHandler: requirePermission('doctor:create'),
    },
    controller.create,
  );

  // doctor:list/read/read_slots no excluyen a ningún rol en la matriz de
  // RFC-004 (todos, incluido el paciente sin cuenta, las tienen) --
  // públicas sin matices, mismo criterio que el directorio ya público hoy.
  app.get('/v1/doctors', { config: { authz: { public: true } } }, controller.listAll);
  app.get<{ Params: DoctorIdParamsDto }>(
    '/v1/doctors/:id',
    { schema: { params: DoctorIdParams }, config: { authz: { public: true } } },
    controller.getById,
  );
  app.get<{ Params: DoctorIdParamsDto; Querystring: GetSlotsQueryDto }>(
    '/v1/doctors/:id/slots',
    {
      schema: { params: DoctorIdParams, querystring: GetSlotsQuery },
      config: { authz: { public: true } },
    },
    controller.getSlots,
  );

  // doctor:manage_availability es 'own' para el rol doctor (RFC-004) -- el
  // chequeo de propiedad (403, no 404: :id ya es público vía doctor:read)
  // vive en doctors.service.ts#addAvailability.
  app.post<{ Params: DoctorIdParamsDto; Body: SetAvailabilityDto }>(
    '/v1/doctors/:id/availability',
    {
      schema: { params: DoctorIdParams, body: SetAvailabilityBody },
      config: { authz: { permission: 'doctor:manage_availability' } },
      preHandler: requirePermission('doctor:manage_availability'),
    },
    controller.setAvailability,
  );
};
