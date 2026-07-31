import type { Prisma } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Ver ADR-002-transacciones-distribuidas.md: el evento se escribe en la
// misma transacción que el cambio de negocio, con publishedAt = null. El
// relay (outbox-relay.ts) lo publica a SNS por fuera de esta transacción
// (ADR-014). tenantId del TenantContext ambiental -- las mutaciones
// públicas ya corren dentro de runWithTenant(doctor.tenantId, ...) antes de
// llegar aquí.
export const writeOutboxEvent = async (
  tx: Prisma.TransactionClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error('writeOutboxEvent() llamado sin tenant en contexto');
  }
  await tx.outboxEvent.create({ data: { tenantId, type, payload: payload as Prisma.InputJsonValue } });
};
