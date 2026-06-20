import type { FastifyReply, FastifyRequest } from 'fastify';

import type {
  AppointmentIdParamsDto,
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
} from './appointments.schemas.js';
import type { AppointmentService } from './appointments.service.js';

const ADMIN_API_KEY_HEADER = 'x-admin-key';

export class AppointmentController {
  constructor(
    private readonly service: AppointmentService,
    private readonly adminApiKey: string,
  ) {}

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
    const appointments = await this.service.list(request.query);
    reply.send(appointments);
  };

  cancel = async (
    request: FastifyRequest<{ Params: AppointmentIdParamsDto; Body: CancelAppointmentDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const cancelledBy = request.headers[ADMIN_API_KEY_HEADER] === this.adminApiKey ? 'ADMIN' : 'PATIENT';
    const result = await this.service.cancel(request.params.id, request.body.reason, cancelledBy);
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

export const buildAppointmentController = (
  service: AppointmentService,
  adminApiKey: string,
): AppointmentController => new AppointmentController(service, adminApiKey);
