import type { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { toAuthzRole } from '../../src/modules/users/users.mapper.js';

describe('toAuthzRole', () => {
  it.each([
    ['PLATFORM_ADMIN', 'platform_admin'],
    ['PLATFORM_SUPPORT', 'platform_support'],
    ['CLINIC_OWNER', 'clinic_owner'],
    ['CLINIC_ADMIN', 'clinic_admin'],
    ['DOCTOR', 'doctor'],
    ['RECEPTIONIST', 'receptionist'],
  ] as const)('mapea el enum de Prisma %s al rol de @clinica/authz %s', (prismaRole, authzRole) => {
    expect(toAuthzRole(prismaRole as UserRole)).toBe(authzRole);
  });
});
