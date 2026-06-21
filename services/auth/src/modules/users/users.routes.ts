import type { FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { buildUsersController } from './users.controller.js';
import { buildUsersRepository, type UsersRepository } from './users.repository.js';
import { CreateUserBody, UserIdParams } from './users.schemas.js';
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
export const registerUsersRoutes = (app: FastifyInstance, deps: UsersRoutesDeps = {}): void => {
  const repository = deps.repository ?? buildUsersRepository(defaultPrisma);
  const service = buildUsersService({ repository, logger: defaultLogger });
  const controller = buildUsersController(service);

  app.post('/v1/users', { schema: { body: CreateUserBody } }, controller.create);
  app.get('/v1/users', controller.list);
  app.patch(
    '/v1/users/:id/deactivate',
    { schema: { params: UserIdParams } },
    controller.deactivate,
  );
};
