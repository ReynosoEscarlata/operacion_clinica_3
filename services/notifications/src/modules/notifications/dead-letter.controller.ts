import type { FastifyReply, FastifyRequest } from 'fastify';

import type { DeadLetterIdParamsDto } from './dead-letter.schemas.js';
import type { DeadLetterService } from './dead-letter.service.js';

export class DeadLetterController {
  constructor(private readonly service: DeadLetterService) {}

  list = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const data = await this.service.list();
    reply.send({ status: 'ok', data, count: data.length });
  };

  retry = async (
    request: FastifyRequest<{ Params: DeadLetterIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await this.service.retry(request.params.id);
    reply.send({ status: 'ok', message: 'Notificación reintentada' });
  };

  remove = async (
    request: FastifyRequest<{ Params: DeadLetterIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await this.service.remove(request.params.id);
    reply.send({ status: 'ok', message: 'Entrada de dead-letter eliminada' });
  };
}

export const buildDeadLetterController = (service: DeadLetterService): DeadLetterController =>
  new DeadLetterController(service);
