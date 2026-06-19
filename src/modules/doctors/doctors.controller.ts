import type { FastifyReply, FastifyRequest } from 'fastify';

import type {
  CreateDoctorDto,
  DoctorIdParamsDto,
  GetSlotsQueryDto,
  SetAvailabilityDto,
} from './doctors.schemas.js';
import type { DoctorService } from './doctors.service.js';

export class DoctorController {
  constructor(private readonly service: DoctorService) {}

  create = async (
    request: FastifyRequest<{ Body: CreateDoctorDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const doctor = await this.service.create(request.body);
    reply.status(201).send(doctor);
  };

  getById = async (
    request: FastifyRequest<{ Params: DoctorIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const doctor = await this.service.getById(request.params.id);
    reply.send(doctor);
  };

  listAll = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const doctors = await this.service.listAll();
    reply.send(doctors);
  };

  setAvailability = async (
    request: FastifyRequest<{ Params: DoctorIdParamsDto; Body: SetAvailabilityDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const availability = await this.service.setAvailability(request.params.id, request.body);
    reply.send(availability);
  };

  getSlots = async (
    request: FastifyRequest<{ Params: DoctorIdParamsDto; Querystring: GetSlotsQueryDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const slots = await this.service.getSlots(request.params.id, request.query.date);
    reply.send(slots);
  };
}

export const buildDoctorController = (service: DoctorService): DoctorController =>
  new DoctorController(service);
