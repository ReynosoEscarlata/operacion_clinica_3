import type { RefreshToken, User } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { logger } from '../../src/lib/logger.js';
import { hashPassword } from '../../src/lib/password.js';
import { buildAuthService } from '../../src/modules/auth/auth.service.js';
import type { RefreshTokenRepository } from '../../src/modules/auth/refresh-token.repository.js';
import type { UsersRepository } from '../../src/modules/users/users.repository.js';

const buildUsersRepository = (users: User[]): UsersRepository => ({
  create: async () => {
    throw new Error('no usado en este test');
  },
  findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
  findById: async (id) => users.find((u) => u.id === id) ?? null,
  list: async () => users,
  deactivate: async () => null,
});

const buildRefreshTokenRepository = (): RefreshTokenRepository & { issued: string[] } => {
  const records = new Map<string, RefreshToken>();
  const issued: string[] = [];

  return {
    issued,
    issue: async (userId: string) => {
      const plain = `refresh-${records.size + 1}`;
      const record: RefreshToken = {
        id: `rt-${records.size + 1}`,
        userId,
        tokenHash: plain,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        createdAt: new Date(),
      };
      records.set(plain, record);
      issued.push(plain);
      return { plain, record };
    },
    findActiveByToken: async (plain: string) => {
      const record = records.get(plain);
      if (!record || record.revokedAt) return null;
      return record;
    },
    revoke: async (id: string) => {
      for (const record of records.values()) {
        if (record.id === id) {
          record.revokedAt = new Date();
        }
      }
    },
  };
};

describe('AuthService', () => {
  it('login exitoso devuelve accessToken y refreshToken', async () => {
    const passwordHash = await hashPassword('correcto-123');
    const user: User = {
      id: 'user-1',
      email: 'admin@clinica.test',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const service = buildAuthService({
      usersRepository: buildUsersRepository([user]),
      refreshTokenRepository: buildRefreshTokenRepository(),
      logger,
    });

    const result = await service.login('admin@clinica.test', 'correcto-123');

    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
  });

  it('login con password incorrecto lanza UNAUTHORIZED', async () => {
    const passwordHash = await hashPassword('correcto-123');
    const user: User = {
      id: 'user-1',
      email: 'admin@clinica.test',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const service = buildAuthService({
      usersRepository: buildUsersRepository([user]),
      refreshTokenRepository: buildRefreshTokenRepository(),
      logger,
    });

    await expect(service.login('admin@clinica.test', 'incorrecto')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('login de usuario desactivado lanza UNAUTHORIZED', async () => {
    const passwordHash = await hashPassword('correcto-123');
    const user: User = {
      id: 'user-1',
      email: 'admin@clinica.test',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const service = buildAuthService({
      usersRepository: buildUsersRepository([user]),
      refreshTokenRepository: buildRefreshTokenRepository(),
      logger,
    });

    await expect(service.login('admin@clinica.test', 'correcto-123')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('refresh rota el token: el anterior queda inválido tras usarse', async () => {
    const passwordHash = await hashPassword('correcto-123');
    const user: User = {
      id: 'user-1',
      email: 'admin@clinica.test',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const refreshTokenRepository = buildRefreshTokenRepository();
    const service = buildAuthService({
      usersRepository: buildUsersRepository([user]),
      refreshTokenRepository,
      logger,
    });

    const { refreshToken } = await service.login('admin@clinica.test', 'correcto-123');
    const second = await service.refresh(refreshToken);

    expect(second.refreshToken).not.toBe(refreshToken);
    await expect(service.refresh(refreshToken)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
