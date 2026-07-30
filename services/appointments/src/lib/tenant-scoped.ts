import type { Prisma, PrismaClient } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Repositorio base (ADR-006, defensa en profundidad). Ver el equivalente en
// services/auth/src/lib/tenant-scoped.ts para la explicación completa de por
// qué `set_config(..., true)` (equivalente a SET LOCAL) y nunca
// interpolación de string.
export interface WithTenantOptions {
  // Se propaga tal cual a `prisma.$transaction` -- necesario para
  // createPending (Serializable, detección de choque de horario). set_config
  // no interfiere con el isolation level: son mecanismos independientes de
  // la misma transacción.
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

export const withTenantId = async <T>(
  prisma: PrismaClient,
  tenantId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: WithTenantOptions,
): Promise<T> => {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
      return fn(tx);
    },
    options?.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined,
  );
};

export const withTenant = async <T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: WithTenantOptions,
): Promise<T> => {
  const tenantId = getTenantId();

  if (tenantId === undefined) {
    throw new Error(
      'withTenant() llamado fuera de un request con TenantContext poblado -- revisar que registerTenantContext esté registrado antes de esta ruta',
    );
  }

  return withTenantId(prisma, tenantId, fn, options);
};

// Resuelve el tenantId de un recurso a partir SOLO de su id, vía las
// funciones SECURITY DEFINER de la migración -- usado por las rutas
// públicas por posesión de UUID (GET/PATCH /v1/appointments/:id,
// GET /v1/patients/:id). Devuelve null si el id no existe (nunca lanza),
// dejando que el caller decida el 404.
export const resolveTenantForAppointment = async (
  prisma: PrismaClient,
  appointmentId: string,
): Promise<string | null> => {
  const rows = await prisma.$queryRaw<Array<{ tenantId: string | null }>>`
    SELECT resolve_tenant_for_appointment(${appointmentId}::uuid) AS "tenantId"
  `;
  return rows[0]?.tenantId ?? null;
};

export const resolveTenantForPatient = async (
  prisma: PrismaClient,
  patientId: string,
): Promise<string | null> => {
  const rows = await prisma.$queryRaw<Array<{ tenantId: string | null }>>`
    SELECT resolve_tenant_for_patient(${patientId}::uuid) AS "tenantId"
  `;
  return rows[0]?.tenantId ?? null;
};
