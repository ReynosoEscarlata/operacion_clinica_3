import type { PrismaClient } from '@prisma/client';

import type { Logger } from '../lib/logger.js';
import { PAYMENT_DATA_RETENTION_DAYS } from '../lib/retention-policy.js';
import { runWithTenant } from '../lib/tenant-context.js';
import { withTenantId } from '../lib/tenant-scoped.js';

export interface PurgeReport {
  cutoff: Date;
  dryRun: boolean;
  webhookEventsFound: number;
  webhookEventsDeleted: number;
  outboxEventsFound: number;
  outboxEventsDeleted: number;
}

interface PurgeCandidate {
  id: string;
  tenantId: string | null;
}

const computeCutoff = (now: Date): Date => {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - PAYMENT_DATA_RETENTION_DAYS);
  return cutoff;
};

export interface PurgeExpiredDataDeps {
  prisma: PrismaClient;
  logger: Logger;
}

// Fase 5 (ADR-016): job de purga de retención. Sin relaciones entre
// WebhookEvent/OutboxEvent (a diferencia de Appointment/Patient en
// Appointments) -- se purgan independientemente, cada una en su propio
// runWithTenant/withTenantId por fila (WebhookEvent.tenantId puede ser
// null, mismo patrón que webhook.service.ts).
export const purgeExpiredData = async (
  deps: PurgeExpiredDataDeps,
  options: { dryRun: boolean; now?: Date },
): Promise<PurgeReport> => {
  const cutoff = computeCutoff(options.now ?? new Date());
  const { prisma, logger } = deps;

  const webhookCandidates = await prisma.$queryRaw<PurgeCandidate[]>`
    SELECT id, "tenantId" FROM list_webhook_events_before_retention_cutoff(${cutoff})
  `;
  let webhookEventsDeleted = 0;

  if (!options.dryRun) {
    for (const candidate of webhookCandidates) {
      try {
        await runWithTenant(candidate.tenantId, () =>
          withTenantId(prisma, candidate.tenantId, (tx) => tx.webhookEvent.delete({ where: { id: candidate.id } })),
        );
        webhookEventsDeleted += 1;
      } catch (error) {
        logger.error({ err: error, webhookEventId: candidate.id }, 'Error al purgar WebhookEvent vencido');
      }
    }
  }

  const outboxCandidates = await prisma.$queryRaw<PurgeCandidate[]>`
    SELECT id, "tenantId" FROM list_outbox_events_before_retention_cutoff(${cutoff})
  `;
  let outboxEventsDeleted = 0;

  if (!options.dryRun) {
    for (const candidate of outboxCandidates) {
      try {
        await runWithTenant(candidate.tenantId, () =>
          withTenantId(prisma, candidate.tenantId, (tx) => tx.outboxEvent.delete({ where: { id: candidate.id } })),
        );
        outboxEventsDeleted += 1;
      } catch (error) {
        logger.error({ err: error, outboxEventId: candidate.id }, 'Error al purgar OutboxEvent vencido');
      }
    }
  }

  const report: PurgeReport = {
    cutoff,
    dryRun: options.dryRun,
    webhookEventsFound: webhookCandidates.length,
    webhookEventsDeleted,
    outboxEventsFound: outboxCandidates.length,
    outboxEventsDeleted,
  };

  logger.info(report, options.dryRun ? 'Purga de retención (dry-run)' : 'Purga de retención completada');

  return report;
};
