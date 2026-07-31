import type { DeadLetterEntry, Prisma, PrismaClient } from '@prisma/client';

import { withTenant, withTenantId } from '../../lib/tenant-scoped.js';

export interface DeadLetterRepository {
  list: () => Promise<DeadLetterEntry[]>;
  findById: (id: string) => Promise<DeadLetterEntry | null>;
  remove: (id: string) => Promise<void>;
  record: (
    tenantId: string,
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    error: string,
    attempts: number,
  ) => Promise<void>;
}

// tenantId se recibe explícito en `record` (no del TenantContext ambiental):
// quien la llama (server.ts, onDeadLetter) corre en el consumer en
// background, sin ningún TenantContext de request -- el tenant ya viene
// resuelto del envelope del evento que falló.
export const buildDeadLetterRepository = (prisma: PrismaClient): DeadLetterRepository => ({
  list: () => withTenant(prisma, (tx) => tx.deadLetterEntry.findMany({ orderBy: { failedAt: 'desc' }, take: 200 })),
  findById: (id) => withTenant(prisma, (tx) => tx.deadLetterEntry.findUnique({ where: { id } })),
  remove: async (id) => {
    await withTenant(prisma, (tx) => tx.deadLetterEntry.delete({ where: { id } }));
  },
  record: async (tenantId, eventId, eventType, payload, error, attempts) => {
    await withTenantId(prisma, tenantId, (tx) =>
      tx.deadLetterEntry.create({
        data: { tenantId, eventId, eventType, payload: payload as Prisma.InputJsonValue, error, attempts },
      }),
    );
  },
});
