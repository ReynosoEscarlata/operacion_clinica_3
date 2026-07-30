import type { DeadLetterEntry, Prisma, PrismaClient } from '@prisma/client';

import { withTenant, withTenantId } from './tenant-scoped.js';

export interface DeadLetterRepository {
  record: (
    tenantId: string,
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    error: string,
    attempts: number,
  ) => Promise<void>;
  list: () => Promise<DeadLetterEntry[]>;
  findById: (id: string) => Promise<DeadLetterEntry | null>;
  remove: (id: string) => Promise<void>;
}

const MAX_LIST_RESULTS = 200;

// tenantId se recibe explícito en `record` (no del TenantContext ambiental):
// quien la llama (server.ts, onDeadLetter) resuelve el tenant del evento
// fallido a partir de su appointmentId embebido, vía
// resolveTenantForAppointment -- no hay garantía de que exista un tenant
// ambiental corriendo un consumer en background.
export const buildDeadLetterRepository = (prisma: PrismaClient): DeadLetterRepository => ({
  record: async (tenantId, eventId, eventType, payload, error, attempts) => {
    // withTenantId explícito (no la ambiental withTenant): quien llama
    // (onDeadLetter en server.ts) corre en un consumer en background sin
    // ningún TenantContext de request -- el tenant ya viene resuelto como
    // parámetro.
    await withTenantId(prisma, tenantId, (tx) =>
      tx.deadLetterEntry.create({
        data: { tenantId, eventId, eventType, payload: payload as Prisma.InputJsonValue, error, attempts },
      }),
    );
  },

  list: async () =>
    withTenant(prisma, (tx) => tx.deadLetterEntry.findMany({ orderBy: { failedAt: 'desc' }, take: MAX_LIST_RESULTS })),

  findById: async (id) => withTenant(prisma, (tx) => tx.deadLetterEntry.findUnique({ where: { id } })),

  remove: async (id) => {
    await withTenant(prisma, (tx) => tx.deadLetterEntry.delete({ where: { id } }));
  },
});
