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
    const user = await this.usersRepository.findByEmail(email);

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

    const accessToken = await signAccessToken({ sub: user.id, role: user.role });
    const { plain: refreshToken } = await this.refreshTokenRepository.issue(user.id);

    this.logger.info({ userId: user.id }, 'Login exitoso');

    return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
  }

  async refresh(refreshTokenPlain: string): Promise<TokenPair> {
    const record = await this.refreshTokenRepository.findActiveByToken(refreshTokenPlain);
    if (!record) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o expirado');
    }

    const user = await this.usersRepository.findById(record.userId);
    if (!user || !user.active) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o expirado');
    }

    // Rotación: el refresh token usado se revoca y se emite uno nuevo,
    // limitando el daño si un refresh token se filtra y se reutiliza.
    await this.refreshTokenRepository.revoke(record.id);

    const accessToken = await signAccessToken({ sub: user.id, role: user.role });
    const { plain: newRefreshToken } = await this.refreshTokenRepository.issue(user.id);

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
