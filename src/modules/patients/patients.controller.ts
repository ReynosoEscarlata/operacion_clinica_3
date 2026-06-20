import type { FastifyReply, FastifyRequest } from 'fastify';

import type {
  CreatePatientDto,
  FindPatientByEmailQueryDto,
  ListPatientsQueryDto,
  PatientIdParamsDto,
  UpdatePatientDto,
} from './patients.schemas.js';
import type { PatientService } from './patients.service.js';

export class PatientController {
  constructor(private readonly service: PatientService) {}

  create = async (
    request: FastifyRequest<{ Body: CreatePatientDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const patient = await this.service.create(request.body);
    reply.status(201).send(patient);
  };

  getById = async (
    request: FastifyRequest<{ Params: PatientIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const patient = await this.service.getById(request.params.id);
    reply.send(patient);
  };

  findByEmail = async (
    request: FastifyRequest<{ Querystring: FindPatientByEmailQueryDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const patient = await this.service.getByEmail(request.query.email);
    reply.send(patient);
  };

  update = async (
    request: FastifyRequest<{ Params: PatientIdParamsDto; Body: UpdatePatientDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const patient = await this.service.update(request.params.id, request.body);
    reply.send(patient);
  };

  list = async (
    request: FastifyRequest<{ Querystring: ListPatientsQueryDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.list(request.query);
    reply.send(result);
  };
}

export const buildPatientController = (service: PatientService): PatientController =>
  new PatientController(service);
