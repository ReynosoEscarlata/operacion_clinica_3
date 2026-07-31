import type { Prisma } from '@prisma/client';

import { getTenantId } from './tenant-context.js';

// Ver ADR-002-transacciones-distribuidas.md: el evento se escribe en la
// misma transacción que el cambio de negocio. El relay que lo publica a
// SNS (lib/outbox-relay.ts, Fase 3b/ADR-014) corre aparte. tenantId se toma
// del TenantContext ambiental (null para operaciones de plataforma, que no
// se construyen en esta fase) -- si el relay encuentra un evento con
// tenantId null, no lo publica (ver MissingTenantIdError en
// outbox-relay.ts).
export const writeOutboxEvent = async (
  tx: Prisma.TransactionClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const tenantId = getTenantId() ?? null;
  await tx.outboxEvent.create({ data: { tenantId, type, payload: payload as Prisma.InputJsonValue } });
};
