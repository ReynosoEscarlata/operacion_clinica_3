import type { Prisma, PrismaClient } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Repositorio base (ADR-006, defensa en profundidad, capa 2 y 3): ningún
// acceso a datos debe ir fuera de esta función. Abre una transacción y fija
// `app.current_tenant` con `set_config(..., true)` -- el tercer argumento
// `true` es el equivalente de `SET LOCAL` (vigente solo dentro de la
// transacción actual, nunca a nivel de sesión/conexión, que con connection
// pooling filtraría el tenant a la siguiente request que reuse la conexión).
// Se usa `set_config` como llamada a función parametrizada, NUNCA
// interpolación de `SET LOCAL app.current_tenant = '${tenantId}'` -- aunque
// tenantId ya viene de un JWT verificado, la capa de defensa en profundidad
// asume que el código de arriba puede tener un bug algún día.
// Variante explícita: usada cuando el tenant se resuelve DENTRO del propio
// flujo (login, refresh) en vez de venir ya poblado en el TenantContext
// ambiental -- ver lib/tenant-context.ts y las funciones SECURITY DEFINER de
// la migración (`find_user_for_login`, etc.) para el porqué: autenticar a
// alguien requiere una búsqueda cross-tenant antes de que exista un tenant
// conocido.
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
