import type { PrismaClient } from '@prisma/client';

import { env } from '../../config/env.js';
import { AppError } from '../../lib/app-error.js';
import { writeAuditLog } from '../../lib/audit-log.js';
import { signAccessToken } from '../../lib/jwt.js';
import type { Logger } from '../../lib/logger.js';
import { verifyPassword } from '../../lib/password.js';
import { withTenantId } from '../../lib/tenant-scoped.js';
import { toAuthzRole } from '../users/users.mapper.js';
import type { UsersRepository } from '../users/users.repository.js';
import type { RefreshTokenRepository } from './refresh-token.repository.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly logger: Logger,
    private readonly prisma: PrismaClient,
  ) {}

  async login(email: string, password: string): Promise<TokenPair> {
    // Búsqueda cross-tenant intencional (find_user_for_login, SECURITY
    // DEFINER): antes de autenticar no se conoce el tenant del usuario --
    // es la razón de ser del login.
    const user = await this.usersRepository.findByEmailForLogin(email);

    // Mismo mensaje genérico exista o no el usuario, y exista o no
    // coincidencia de password: evita que un atacante enumere emails
    // válidos a partir de la diferencia de respuesta.
    if (!user || !user.active) {
      throw new AppError(401, 'UNAUTHORIZED', 'Credenciales inválidas');
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError(401, 'UNAUTHORIZED', 'Credenciales inválidas');
    }

    const actorRole = toAuthzRole(user.role);
    const accessToken = await signAccessToken({
      sub: user.id,
      role: actorRole,
      tenantId: user.tenantId,
      doctorId: user.doctorId,
    });
    // tenantId de User es nullable en el esquema (RFC-003: NULL = roles de
    // plataforma, RFC-004) -- issue() recibe tenantId tal cual (puede ser
    // null) más el rol del actor, que activa la rama de plataforma de la
    // política RLS de RefreshToken cuando corresponde (ver tenant-scoped.ts).
    const { plain: refreshToken } = await this.refreshTokenRepository.issue(user.id, user.tenantId, actorRole);

    // Fase 5 (ADR-013): sin TenantContext/AuthActor ambiental todavía en
    // este punto (el request llegó sin autenticar) -- actor explícito, no
    // el default ambiental de writeAuditLog(). Si el insert falla, se deja
    // propagar: el login no debe devolver tokens sin haber quedado
    // auditado.
    await withTenantId(
      this.prisma,
      user.tenantId,
      (tx) =>
        writeAuditLog(tx, 'user.login', 'user', user.id, 'success', {
          actor: { tenantId: user.tenantId, actorId: user.id, actorRole },
        }),
      actorRole,
    );

    this.logger.info({ userId: user.id }, 'Login exitoso');

    return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
  }

  async refresh(refreshTokenPlain: string): Promise<TokenPair> {
    // Búsqueda cross-tenant intencional (find_refresh_token_for_refresh) --
    // mismo motivo que login: el tenant del portador del token todavía no
    // se conoce en este punto.
    const record = await this.refreshTokenRepository.findActiveByToken(refreshTokenPlain);
    if (!record) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o expirado');
    }

    const user = await this.usersRepository.findByIdForRefresh(record.userId);
    if (!user || !user.active) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o expirado');
    }

    const actorRole = toAuthzRole(user.role);

    // Rotación: el refresh token usado se revoca y se emite uno nuevo,
    // limitando el daño si un refresh token se filtra y se reutiliza.
    await this.refreshTokenRepository.revoke(record.id, record.tenantId, actorRole);

    const accessToken = await signAccessToken({
      sub: user.id,
      role: actorRole,
      tenantId: user.tenantId,
      doctorId: user.doctorId,
    });
    const { plain: newRefreshToken } = await this.refreshTokenRepository.issue(
      user.id,
      record.tenantId,
      actorRole,
    );

    await withTenantId(
      this.prisma,
      record.tenantId,
      (tx) =>
        writeAuditLog(tx, 'user.token_refreshed', 'user', user.id, 'success', {
          actor: { tenantId: record.tenantId, actorId: user.id, actorRole },
        }),
      actorRole,
    );

    return { accessToken, refreshToken: newRefreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
  }
}

export interface AuthServiceDeps {
  usersRepository: UsersRepository;
  refreshTokenRepository: RefreshTokenRepository;
  logger: Logger;
  prisma: PrismaClient;
}

export const buildAuthService = (deps: AuthServiceDeps): AuthService =>
  new AuthService(deps.usersRepository, deps.refreshTokenRepository, deps.logger, deps.prisma);
