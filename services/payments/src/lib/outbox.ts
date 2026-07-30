import type { Prisma } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Ver ADR-002-transacciones-distribuidas.md: el evento se escribe en la
// misma transacción que el cambio de negocio. El relay que lo publica a
// Redis Streams se implementa en la Fase 3 del plan — por ahora solo queda
// persistido con publishedAt = null. tenantId del TenantContext ambiental
// -- webhook.service.ts ya resolvió el tenant (desde el metadata del
// PaymentIntent) y entró en runWithTenant(tenantId, ...) antes de llegar
// aquí; si no pudo resolverlo, nunca llama a esta función (ver
// handlePaymentSucceeded/handlePaymentFailed).
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
