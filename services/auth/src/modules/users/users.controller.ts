import type { FastifyReply, FastifyRequest } from 'fastify';

import type { CreateUserDto, UserIdParamsDto } from './users.schemas.js';
import type { UsersService } from './users.service.js';

export class UsersController {
  constructor(private readonly service: UsersService) {}

  create = async (
    request: FastifyRequest<{ Body: CreateUserDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const user = await this.service.create(request.body);
    reply.status(201).send(user);
  };

  list = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const users = await this.service.list();
    reply.send({ data: users });
  };

  deactivate = async (
    request: FastifyRequest<{ Params: UserIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const user = await this.service.deactivate(request.params.id);
    reply.send(user);
  };
}

export const buildUsersController = (service: UsersService): UsersController =>
  new UsersController(service);
