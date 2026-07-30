import type { Prisma } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Ver ADR-002-transacciones-distribuidas.md: el evento se escribe en la
// misma transacción que el cambio de negocio. El relay (SQS/SNS, Fase 3b,
// ADR-014) se implementa aparte. tenantId del TenantContext ambiental --
// esta función solo se llama desde mutaciones (create/addAvailability), que
// siempre tienen tenant (Doctors no tiene roles de plataforma sin tenant).
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
