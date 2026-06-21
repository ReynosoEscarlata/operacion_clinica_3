import type { User } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { buildUsersService } from '../../src/modules/users/users.service.js';
import type { CreateUserData, UsersRepository } from '../../src/modules/users/users.repository.js';
import { logger } from '../../src/lib/logger.js';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'admin@clinica.test',
  name: 'Admin',
  passwordHash: 'hashed',
  role: 'ADMIN',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const buildFakeRepository = (initial: User[] = []): UsersRepository => {
  const users = [...initial];

  return {
    create: async (data: CreateUserData) => {
      const user = buildUser({ id: `user-${users.length + 1}`, ...data });
      users.push(user);
      return user;
    },
    findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
    findById: async (id) => users.find((u) => u.id === id) ?? null,
    list: async () => users,
    deactivate: async (id) => {
      const user = users.find((u) => u.id === id);
      if (!user) return null;
      user.active = false;
      return user;
    },
  };
};

describe('UsersService', () => {
  it('crea un usuario y nunca expone el passwordHash', async () => {
    const service = buildUsersService({ repository: buildFakeRepository(), logger });

    const user = await service.create({
      email: 'admin@clinica.test',
      name: 'Admin',
      role: 'ADMIN',
      password: 'super-secreta',
    });

    expect(user.email).toBe('admin@clinica.test');
    expect('passwordHash' in user).toBe(false);
  });

  it('rechaza crear un usuario con email ya existente', async () => {
    const repository = buildFakeRepository([buildUser()]);
    const service = buildUsersService({ repository, logger });

    await expect(
      service.create({
        email: 'admin@clinica.test',
        name: 'Otro',
        role: 'STAFF',
        password: 'super-secreta',
      }),
    ).rejects.toMatchObject({ code: 'USER_EMAIL_TAKEN' });
  });

  it('desactivar un usuario inexistente lanza USER_NOT_FOUND', async () => {
    const service = buildUsersService({ repository: buildFakeRepository(), logger });

    await expect(service.deactivate('no-existe')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});
