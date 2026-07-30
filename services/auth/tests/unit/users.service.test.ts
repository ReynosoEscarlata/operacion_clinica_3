import type { User } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { buildUsersService } from '../../src/modules/users/users.service.js';
import type { CreateUserData, UsersRepository } from '../../src/modules/users/users.repository.js';
import { logger } from '../../src/lib/logger.js';
import { tenantContextStorage } from '../../src/lib/tenant-context.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  tenantId: TENANT_A,
  email: 'admin@clinica.test',
  name: 'Admin',
  passwordHash: 'hashed',
  role: 'CLINIC_OWNER',
  doctorId: null,
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
    findByEmailForLogin: async (email) => {
      const user = users.find((u) => u.email === email);
      if (!user) return null;
      return {
        id: user.id,
        tenantId: user.tenantId,
        passwordHash: user.passwordHash,
        active: user.active,
        role: user.role,
        doctorId: user.doctorId,
      };
    },
    findByIdForRefresh: async (id) => {
      const user = users.find((u) => u.id === id);
      if (!user) return null;
      return { id: user.id, tenantId: user.tenantId, active: user.active, role: user.role, doctorId: user.doctorId };
    },
  };
};

describe('UsersService', () => {
  it('crea un usuario y nunca expone el passwordHash', async () => {
    const service = buildUsersService({ repository: buildFakeRepository(), logger });

    const user = await service.create({
      email: 'admin@clinica.test',
      name: 'Admin',
      role: 'CLINIC_OWNER',
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
        role: 'RECEPTIONIST',
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

  it('un actor de tenant no puede crear un usuario con rol de plataforma', async () => {
    const service = buildUsersService({ repository: buildFakeRepository(), logger });

    await tenantContextStorage.run({ tenantId: TENANT_A }, async () => {
      await expect(
        service.create({
          email: 'nuevo-admin@clinica.test',
          name: 'Intento',
          role: 'PLATFORM_ADMIN',
          password: 'super-secreta',
        }),
      ).rejects.toMatchObject({ code: 'CANNOT_ASSIGN_PLATFORM_ROLE' });
    });
  });

  it('un actor de plataforma (tenantId null) sí puede crear un usuario con rol de plataforma', async () => {
    const service = buildUsersService({ repository: buildFakeRepository(), logger });

    await tenantContextStorage.run({ tenantId: null }, async () => {
      const user = await service.create({
        email: 'nuevo-support@clinica.test',
        name: 'Soporte',
        role: 'PLATFORM_SUPPORT',
        password: 'super-secreta',
      });
      expect(user.role).toBe('PLATFORM_SUPPORT');
    });
  });

  it('role DOCTOR sin doctorId lanza DOCTOR_ID_REQUIRED', async () => {
    const service = buildUsersService({ repository: buildFakeRepository(), logger });

    await tenantContextStorage.run({ tenantId: TENANT_A }, async () => {
      await expect(
        service.create({
          email: 'doctor@clinica.test',
          name: 'Dr. Sin Id',
          role: 'DOCTOR',
          password: 'super-secreta',
        }),
      ).rejects.toMatchObject({ code: 'DOCTOR_ID_REQUIRED' });
    });
  });

  it('doctorId en un rol que no es DOCTOR lanza DOCTOR_ID_NOT_ALLOWED', async () => {
    const service = buildUsersService({ repository: buildFakeRepository(), logger });

    await tenantContextStorage.run({ tenantId: TENANT_A }, async () => {
      await expect(
        service.create({
          email: 'receptionist@clinica.test',
          name: 'Recepcionista',
          role: 'RECEPTIONIST',
          doctorId: '22222222-2222-2222-2222-222222222222',
          password: 'super-secreta',
        }),
      ).rejects.toMatchObject({ code: 'DOCTOR_ID_NOT_ALLOWED' });
    });
  });
});
