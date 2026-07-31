import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../lib/app-error.js';
import type { PlatformUsersService } from './platform-users.service.js';

// Mismo guard de defensa en profundidad que
// services/appointments/src/modules/platform/platform.controller.ts --
// además de requirePermission('platform_dashboard:read'), un rol de
// plataforma NUNCA lleva tenantId (RFC-003/RFC-004).
const assertPlatformActor = (request: FastifyRequest): void => {
  if (request.authActor?.tenantId !== null) {
    throw new AppError(403, 'FORBIDDEN', 'Este endpoint es exclusivo del plano de plataforma');
  }
};

export class PlatformUsersController {
  constructor(private readonly service: PlatformUsersService) {}

  getActive = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    assertPlatformActor(request);
    const activeByRole = await this.service.getActiveUserCounts();
    reply.send({ activeByRole });
  };
}

export const buildPlatformUsersController = (service: PlatformUsersService): PlatformUsersController =>
  new PlatformUsersController(service);
