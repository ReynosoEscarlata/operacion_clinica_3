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

  // Públicas por diseño (RFC-004: auth:login/auth:refresh no son un permiso
  // -- acceso anónimo): el actor todavía no está autenticado en el momento
  // de llamarlas, y JWKS es la llave pública que hace falta para verificar
  // cualquier JWT en primer lugar.
  app.post(
    '/v1/auth/login',
    { schema: { body: LoginBody }, config: { authz: { public: true } } },
    controller.login,
  );
  app.post(
    '/v1/auth/refresh',
    { schema: { body: RefreshBody }, config: { authz: { public: true } } },
    controller.refresh,
  );

  app.get(
    '/v1/auth/.well-known/jwks.json',
    { config: { authz: { public: true } } },
    async () => {
      const { publicJwk } = await getSigningKeys();
      return { keys: [publicJwk] };
    },
  );
};
