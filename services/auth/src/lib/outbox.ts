import type { Prisma } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Ver ADR-002-transacciones-distribuidas.md: el evento se escribe en la
// misma transacción que el cambio de negocio. El relay que lo publica
// (Redis Streams hoy, SQS/SNS en la Fase 3b, ADR-014) se implementa aparte
// — por ahora solo queda persistido con publishedAt = null. tenantId se
// toma del TenantContext ambiental (null para operaciones de plataforma,
// que no se construyen en esta fase) -- el envelope de eventos lo exige
// ADR-014/RFC-003 para la Fase 3b.
export const writeOutboxEvent = async (
  tx: Prisma.TransactionClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const tenantId = getTenantId() ?? null;
  await tx.outboxEvent.create({ data: { tenantId, type, payload: payload as Prisma.InputJsonValue } });
};
