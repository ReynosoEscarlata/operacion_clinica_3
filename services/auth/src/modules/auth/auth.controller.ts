import type { FastifyReply, FastifyRequest } from 'fastify';

import type { LoginDto, RefreshDto } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (
    request: FastifyRequest<{ Body: LoginDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const tokens = await this.service.login(request.body.email, request.body.password);
    reply.send(tokens);
  };

  refresh = async (
    request: FastifyRequest<{ Body: RefreshDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const tokens = await this.service.refresh(request.body.refreshToken);
    reply.send(tokens);
  };
}

export const buildAuthController = (service: AuthService): AuthController =>
  new AuthController(service);
