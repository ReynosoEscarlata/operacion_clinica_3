import type { Prisma } from '@prisma/client';

// Ver ADR-002-transacciones-distribuidas.md: el evento se escribe en la
// misma transacción que el cambio de negocio. El relay que lo publica a
// Redis Streams se implementa en la Fase 3 del plan — por ahora solo queda
// persistido con publishedAt = null.
export const writeOutboxEvent = async (
  tx: Prisma.TransactionClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  await tx.outboxEvent.create({ data: { type, payload: payload as Prisma.InputJsonValue } });
};
