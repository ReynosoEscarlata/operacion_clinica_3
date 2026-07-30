import { requirePermission } from '@clinica/authz';
import type { FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { buildUsersController } from './users.controller.js';
import { buildUsersRepository, type UsersRepository } from './users.repository.js';
import { CreateUserBody, UserIdParams, type CreateUserDto, type UserIdParamsDto } from './users.schemas.js';
import { buildUsersService } from './users.service.js';

export interface UsersRoutesDeps {
  repository?: UsersRepository;
}

// Estas rutas no verifican JWT por sí mismas: confían en que el gateway ya
// lo hizo (gateway/src/middleware/verify-jwt.ts las marca como protegidas,
// no públicas). Es un límite de confianza de red interna, no defensa en
// profundidad — aceptable mientras el tráfico a Auth solo pueda originarse
// en el gateway (red interna de Docker/Compose). Si Auth llegara a exponerse
// directamente, habría que re-verificar el JWT aquí también.
// requirePermission() (RFC-004/ADR-012) es la segunda capa: incluso con JWT
// válido, el rol del actor debe tener el permiso declarado.
export const registerUsersRoutes = (app: FastifyInstance, deps: UsersRoutesDeps = {}): void => {
  const repository = deps.repository ?? buildUsersRepository(defaultPrisma);
  const service = buildUsersService({ repository, logger: defaultLogger });
  const controller = buildUsersController(service);

  app.post<{ Body: CreateUserDto }>(
    '/v1/users',
    {
      schema: { body: CreateUserBody },
      config: { authz: { permission: 'user:create' } },
      preHandler: requirePermission('user:create'),
    },
    controller.create,
  );
  app.get(
    '/v1/users',
    { config: { authz: { permission: 'user:list' } }, preHandler: requirePermission('user:list') },
    controller.list,
  );
  app.patch<{ Params: UserIdParamsDto }>(
    '/v1/users/:id/deactivate',
    {
      schema: { params: UserIdParams },
      config: { authz: { permission: 'user:deactivate' } },
      preHandler: requirePermission('user:deactivate'),
    },
    controller.deactivate,
  );
};
