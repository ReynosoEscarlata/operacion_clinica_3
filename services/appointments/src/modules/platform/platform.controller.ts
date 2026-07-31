import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../lib/app-error.js';
import type { PlatformService } from './platform.service.js';

// Segunda capa de defensa, además de requirePermission('platform_dashboard:read')
// en la ruta (RFC-004): un rol de plataforma NUNCA lleva tenantId (RFC-003).
// Si la matriz de permisos alguna vez se reconfigurara mal y le diera este
// permiso a un rol de tenant, este guard sigue bloqueando -- este módulo no
// usa withTenant()/runWithTenant() en ningún punto, así que un actor con
// tenantId no-null aquí es siempre una señal de que algo está mal
// configurado, nunca un caso válido.
const assertPlatformActor = (request: FastifyRequest): void => {
  if (request.authActor?.tenantId !== null) {
    throw new AppError(403, 'FORBIDDEN', 'Este endpoint es exclusivo del plano de plataforma');
  }
};

export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  getDashboard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    assertPlatformActor(request);
    const stats = await this.service.getDashboard();
    reply.send(stats);
  };

  getMetrics = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    assertPlatformActor(request);
    const result = await this.service.getMetrics();
    reply.send(result);
  };
}

export const buildPlatformController = (service: PlatformService): PlatformController =>
  new PlatformController(service);
