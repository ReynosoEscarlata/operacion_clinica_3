import type { Prisma, PrismaClient } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Repositorio base (ADR-006, defensa en profundidad). Ver el equivalente en
// services/auth/src/lib/tenant-scoped.ts para la explicación completa de por
// qué `set_config(..., true)` (equivalente a SET LOCAL) y nunca
// interpolación de string.
export const withTenantId = async <T>(
  prisma: PrismaClient,
  tenantId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return fn(tx);
  });
};

export const withTenant = async <T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  const tenantId = getTenantId();

  if (tenantId === undefined) {
    throw new Error(
      'withTenant() llamado fuera de un request con TenantContext poblado -- revisar que registerTenantContext esté registrado antes de esta ruta',
    );
  }

  return withTenantId(prisma, tenantId, fn);
};
