import type { DeadLetterEntry, Prisma, PrismaClient } from '@prisma/client';

import { writeAuditLog } from '../../lib/audit-log.js';
import { withTenant, withTenantId } from '../../lib/tenant-scoped.js';

export interface DeadLetterRepository {
  list: () => Promise<DeadLetterEntry[]>;
  findById: (id: string) => Promise<DeadLetterEntry | null>;
  remove: (id: string, reason: 'retried' | 'manual') => Promise<void>;
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
  // Fase 5 (ADR-013): a diferencia del resto de los servicios, acá SÍ se
  // audita una lectura de lista -- gateada a platform_admin (RFC-004), el
  // payload expone PII de eventos fallidos de un tenant ajeno al actor,
  // exactamente el acceso escalado que el ADR exige trazar (no es el caso
  // de "staff listando sus propios pacientes" que se excluye en otros
  // servicios).
  list: () =>
    withTenant(prisma, async (tx) => {
      const entries = await tx.deadLetterEntry.findMany({ orderBy: { failedAt: 'desc' }, take: 200 });
      await writeAuditLog(tx, 'dead_letter.read', 'dead_letter_entry', null, 'success');
      return entries;
    }),
  findById: (id) => withTenant(prisma, (tx) => tx.deadLetterEntry.findUnique({ where: { id } })),
  remove: async (id, reason) => {
    await withTenant(prisma, async (tx) => {
      await tx.deadLetterEntry.delete({ where: { id } });
      await writeAuditLog(
        tx,
        reason === 'retried' ? 'dead_letter.retried' : 'dead_letter.removed',
        'dead_letter_entry',
        id,
        'success',
      );
    });
  },
  record: async (tenantId, eventId, eventType, payload, error, attempts) => {
    await withTenantId(prisma, tenantId, (tx) =>
      tx.deadLetterEntry.create({
        data: { tenantId, eventId, eventType, payload: payload as Prisma.InputJsonValue, error, attempts },
      }),
    );
  },
});
