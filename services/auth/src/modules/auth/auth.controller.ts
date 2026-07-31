import type { FastifyReply, FastifyRequest } from 'fastify';

import type { LoginDto, RefreshDto, SupportAccessDto } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';
import type { SupportAccessService } from './support-access.service.js';

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly supportAccessService: SupportAccessService,
  ) {}

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

  supportAccess = async (
    request: FastifyRequest<{ Body: SupportAccessDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.supportAccessService.grant(
      request.authActor,
      request.body.tenantId,
      request.body.reason,
      request.body.ttlHours,
    );
    reply.status(201).send(result);
  };
}

export const buildAuthController = (
  service: AuthService,
  supportAccessService: SupportAccessService,
): AuthController => new AuthController(service, supportAccessService);
