import type { FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { getSigningKeys } from '../../lib/keys.js';
import { buildUsersRepository, type UsersRepository } from '../users/users.repository.js';
import { buildAuthController } from './auth.controller.js';
import { LoginBody, RefreshBody } from './auth.schemas.js';
import { buildAuthService } from './auth.service.js';
import {
  buildRefreshTokenRepository,
  type RefreshTokenRepository,
} from './refresh-token.repository.js';

export interface AuthRoutesDeps {
  usersRepository?: UsersRepository;
  refreshTokenRepository?: RefreshTokenRepository;
}

export const registerAuthRoutes = (app: FastifyInstance, deps: AuthRoutesDeps = {}): void => {
  const usersRepository = deps.usersRepository ?? buildUsersRepository(defaultPrisma);
  const refreshTokenRepository =
    deps.refreshTokenRepository ?? buildRefreshTokenRepository(defaultPrisma);
  const service = buildAuthService({ usersRepository, refreshTokenRepository, logger: defaultLogger });
  const controller = buildAuthController(service);

  app.post('/v1/auth/login', { schema: { body: LoginBody } }, controller.login);
  app.post('/v1/auth/refresh', { schema: { body: RefreshBody } }, controller.refresh);

  app.get('/v1/auth/.well-known/jwks.json', async () => {
    const { publicJwk } = await getSigningKeys();
    return { keys: [publicJwk] };
  });
};
