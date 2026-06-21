import type { FastifyReply, FastifyRequest } from 'fastify';

import { resolveCancelledBy } from '../../lib/internal-role.js';
import type {
  AppointmentIdParamsDto,
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
} from './appointments.schemas.js';
import type { AppointmentService } from './appointments.service.js';

export class AppointmentController {
  constructor(private readonly service: AppointmentService) {}

  create = async (
    request: FastifyRequest<{ Body: CreateAppointmentDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.create(request.body, request.requestId);
    reply.status(201).send(result);
  };

  getById = async (
    request: FastifyRequest<{ Params: AppointmentIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const appointment = await this.service.getById(request.params.id);
    reply.send(appointment);
  };

  list = async (
    request: FastifyRequest<{ Querystring: ListAppointmentsQueryDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.list(request.query);
    reply.send(result);
  };

  cancel = async (
    request: FastifyRequest<{ Params: AppointmentIdParamsDto; Body: CancelAppointmentDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.cancel(
      request.params.id,
      request.body.reason,
      resolveCancelledBy(request),
    );
    reply.send(result);
  };

  complete = async (
    request: FastifyRequest<{ Params: AppointmentIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const appointment = await this.service.complete(request.params.id);
    reply.send(appointment);
  };

  markNoShow = async (
    request: FastifyRequest<{ Params: AppointmentIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const appointment = await this.service.markNoShow(request.params.id);
    reply.send(appointment);
  };
}

export const buildAppointmentController = (service: AppointmentService): AppointmentController =>
  new AppointmentController(service);
