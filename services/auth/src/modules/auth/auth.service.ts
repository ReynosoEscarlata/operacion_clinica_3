import { env } from '../../config/env.js';
import { AppError } from '../../lib/app-error.js';
import { signAccessToken } from '../../lib/jwt.js';
import type { Logger } from '../../lib/logger.js';
import { verifyPassword } from '../../lib/password.js';
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

    const accessToken = await signAccessToken({ sub: user.id, role: user.role, tenantId: user.tenantId });
    // tenantId de User es nullable en el esquema (RFC-003: NULL = roles de
    // plataforma), pero esos roles no se construyen en esta fase -- todo
    // usuario real hoy pertenece a un tenant. Si esto cambiara (Fase 4), la
    // emisión de refresh token para un usuario de plataforma necesitará su
    // propio diseño (RefreshToken.tenantId es NOT NULL hoy).
    if (!user.tenantId) {
      throw new AppError(
        500,
        'PLATFORM_USER_LOGIN_NOT_SUPPORTED',
        'Login de usuarios de plataforma no soportado todavía',
      );
    }
    const { plain: refreshToken } = await this.refreshTokenRepository.issue(user.id, user.tenantId);

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

    // Rotación: el refresh token usado se revoca y se emite uno nuevo,
    // limitando el daño si un refresh token se filtra y se reutiliza.
    await this.refreshTokenRepository.revoke(record.id, record.tenantId);

    const accessToken = await signAccessToken({ sub: user.id, role: user.role, tenantId: user.tenantId });
    const { plain: newRefreshToken } = await this.refreshTokenRepository.issue(user.id, record.tenantId);

    return { accessToken, refreshToken: newRefreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
  }
}

export interface AuthServiceDeps {
  usersRepository: UsersRepository;
  refreshTokenRepository: RefreshTokenRepository;
  logger: Logger;
}

export const buildAuthService = (deps: AuthServiceDeps): AuthService =>
  new AuthService(deps.usersRepository, deps.refreshTokenRepository, deps.logger);
