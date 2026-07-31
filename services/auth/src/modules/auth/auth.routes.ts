import type { FastifyInstance } from 'fastify';

import { prisma as defaultPrisma } from '../../config/prisma.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { getSigningKeys } from '../../lib/keys.js';
import { buildUsersRepository, type UsersRepository } from '../users/users.repository.js';
import { buildAuthController } from './auth.controller.js';
import { LoginBody, RefreshBody, SupportAccessBody, type SupportAccessDto } from './auth.schemas.js';
import { buildAuthService } from './auth.service.js';
import {
  buildRefreshTokenRepository,
  type RefreshTokenRepository,
} from './refresh-token.repository.js';
import {
  buildSupportAccessGrantRepository,
  type SupportAccessGrantRepository,
} from './support-access.repository.js';
import { buildSupportAccessService } from './support-access.service.js';

export interface AuthRoutesDeps {
  usersRepository?: UsersRepository;
  refreshTokenRepository?: RefreshTokenRepository;
  supportAccessGrantRepository?: SupportAccessGrantRepository;
}

export const registerAuthRoutes = (app: FastifyInstance, deps: AuthRoutesDeps = {}): void => {
  const usersRepository = deps.usersRepository ?? buildUsersRepository(defaultPrisma);
  const refreshTokenRepository =
    deps.refreshTokenRepository ?? buildRefreshTokenRepository(defaultPrisma);
  const supportAccessGrantRepository =
    deps.supportAccessGrantRepository ?? buildSupportAccessGrantRepository(defaultPrisma);
  const service = buildAuthService({ usersRepository, refreshTokenRepository, logger: defaultLogger });
  const supportAccessService = buildSupportAccessService({
    repository: supportAccessGrantRepository,
    logger: defaultLogger,
  });
  const controller = buildAuthController(service, supportAccessService);

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

  // RFC-004, "Escalada de privilegios": no es un permiso de
  // PERMISSION_MATRIX -- es la infraestructura de la escalada en sí misma,
  // el chequeo de rol (solo platform_admin/platform_support) vive en
  // support-access.service.ts#grant(), no en requirePermission(). El
  // marcador config.authz.public solo satisface el fail-closed de
  // registerAuthzEnforcement (toda ruta /v1/* debe declarar algo) -- la
  // ruta en sí NO es públicamente accesible: no está en PUBLIC_ROUTES del
  // gateway, así que ya exige un JWT válido antes de llegar aquí.
  app.post<{ Body: SupportAccessDto }>(
    '/v1/auth/support-access',
    { schema: { body: SupportAccessBody }, config: { authz: { public: true } } },
    controller.supportAccess,
  );
};
