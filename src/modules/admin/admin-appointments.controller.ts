import type { FastifyReply, FastifyRequest } from 'fastify';

import type {
  AdminAppointmentIdParamsDto,
  AdminCancelAppointmentDto,
  AdminEventsQueryDto,
  AdminListAppointmentsQueryDto,
} from './admin-appointments.schemas.js';
import type { AdminAppointmentsService } from './admin-appointments.service.js';

export class AdminAppointmentsController {
  constructor(private readonly service: AdminAppointmentsService) {}

  list = async (
    request: FastifyRequest<{ Querystring: AdminListAppointmentsQueryDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.list(request.query);
    reply.send(result);
  };

  getById = async (
    request: FastifyRequest<{ Params: AdminAppointmentIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.getDetail(request.params.id);
    reply.send(result);
  };

  cancel = async (
    request: FastifyRequest<{ Params: AdminAppointmentIdParamsDto; Body: AdminCancelAppointmentDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.cancel(request.params.id, request.body.reason);
    reply.send(result);
  };

  complete = async (
    request: FastifyRequest<{ Params: AdminAppointmentIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const appointment = await this.service.complete(request.params.id);
    reply.send(appointment);
  };

  markNoShow = async (
    request: FastifyRequest<{ Params: AdminAppointmentIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const appointment = await this.service.markNoShow(request.params.id);
    reply.send(appointment);
  };

  dashboard = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const stats = await this.service.getDashboard();
    reply.send(stats);
  };

  events = async (
    request: FastifyRequest<{ Querystring: AdminEventsQueryDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const events = await this.service.getRecentEvents(request.query.hours, request.query.limit);
    reply.send(events);
  };
}

export const buildAdminAppointmentsController = (
  service: AdminAppointmentsService,
): AdminAppointmentsController => new AdminAppointmentsController(service);
