import type { FastifyReply, FastifyRequest } from 'fastify';

import type { DeadLetterIdParamsDto, RecentEventsQueryDto } from './admin.schemas.js';
import type { AdminService } from './admin.service.js';

const DEFAULT_EVENTS_WINDOW_HOURS = 24;

export class AdminController {
  constructor(private readonly service: AdminService) {}

  getDashboard = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const stats = await this.service.getDashboard();
    reply.send(stats);
  };

  getRecentEvents = async (
    request: FastifyRequest<{ Querystring: RecentEventsQueryDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const events = await this.service.getRecentEvents(request.query.hours ?? DEFAULT_EVENTS_WINDOW_HOURS);
    reply.send(events);
  };

  listDeadLetter = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const data = await this.service.listDeadLetter();
    reply.send({ status: 'ok', data, count: data.length });
  };

  retryDeadLetter = async (
    request: FastifyRequest<{ Params: DeadLetterIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await this.service.retryDeadLetter(request.params.id);
    reply.send({ status: 'ok', message: 'Evento reencolado para reintento' });
  };

  removeDeadLetter = async (
    request: FastifyRequest<{ Params: DeadLetterIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await this.service.removeDeadLetter(request.params.id);
    reply.send({ status: 'ok', message: 'Entrada de dead-letter eliminada' });
  };
}

export const buildAdminController = (service: AdminService): AdminController => new AdminController(service);
