import type { Prisma, PrismaClient } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Repositorio base (ADR-006, defensa en profundidad). Ver
// services/auth/src/lib/tenant-scoped.ts para la explicación completa de
// por qué `set_config(..., true)` (equivalente a SET LOCAL) y nunca
// interpolación de string.
//
// A diferencia de los demás servicios, `tenantId` aquí puede ser
// legítimamente `null` incluso en el caso "resuelto" (un WebhookEvent de un
// tipo de evento sin tenant asociable, ver migration.sql) -- en ese caso se
// omite el set_config por completo y la política RLS de WebhookEvent (con
// su rama `tenantId IS NULL`) permite la operación de todos modos.
export const withTenantId = async <T>(
  prisma: PrismaClient,
  tenantId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  return prisma.$transaction(async (tx) => {
    if (tenantId !== null) {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    }
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
      'withTenant() llamado fuera de un contexto con TenantContext poblado -- revisar que registerTenantContext (o runWithTenant) haya corrido antes de esta llamada',
    );
  }

  return withTenantId(prisma, tenantId, fn);
};
