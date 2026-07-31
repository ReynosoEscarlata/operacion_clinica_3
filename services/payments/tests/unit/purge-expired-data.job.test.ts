import { describe, expect, it, vi } from 'vitest';

import { purgeExpiredData } from '../../src/jobs/purge-expired-data.job.js';
import { logger } from '../../src/lib/logger.js';

const TENANT_A = 'a0000000-a000-a000-a000-a00000000001';

const buildFakePrisma = (webhookCandidates: unknown[], outboxCandidates: unknown[]) => {
  const deletedWebhookIds: string[] = [];
  const deletedOutboxIds: string[] = [];
  let queryCallCount = 0;

  const prisma = {
    $queryRaw: vi.fn(async () => {
      queryCallCount += 1;
      return queryCallCount === 1 ? webhookCandidates : outboxCandidates;
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: async () => 0,
        webhookEvent: { delete: async ({ where }: { where: { id: string } }) => deletedWebhookIds.push(where.id) },
        outboxEvent: { delete: async ({ where }: { where: { id: string } }) => deletedOutboxIds.push(where.id) },
      };
      return fn(tx);
    }),
  };

  return { prisma, deletedWebhookIds, deletedOutboxIds };
};

describe('purgeExpiredData (Fase 5, ADR-016)', () => {
  it('dry-run reporta candidatos sin borrar nada', async () => {
    const { prisma, deletedWebhookIds, deletedOutboxIds } = buildFakePrisma(
      [{ id: 'wh-1', tenantId: TENANT_A }],
      [{ id: 'ob-1', tenantId: TENANT_A }],
    );

    const report = await purgeExpiredData(
      { prisma: prisma as never, logger },
      { dryRun: true },
    );

    expect(report.dryRun).toBe(true);
    expect(report.webhookEventsFound).toBe(1);
    expect(report.webhookEventsDeleted).toBe(0);
    expect(report.outboxEventsFound).toBe(1);
    expect(report.outboxEventsDeleted).toBe(0);
    expect(deletedWebhookIds).toHaveLength(0);
    expect(deletedOutboxIds).toHaveLength(0);
  });

  it('modo real borra los eventos vencidos, incluidos los de tenantId null', async () => {
    const { prisma, deletedWebhookIds, deletedOutboxIds } = buildFakePrisma(
      [
        { id: 'wh-1', tenantId: TENANT_A },
        { id: 'wh-2', tenantId: null },
      ],
      [{ id: 'ob-1', tenantId: TENANT_A }],
    );

    const report = await purgeExpiredData(
      { prisma: prisma as never, logger },
      { dryRun: false },
    );

    expect(report.webhookEventsDeleted).toBe(2);
    expect(report.outboxEventsDeleted).toBe(1);
    expect(deletedWebhookIds).toEqual(['wh-1', 'wh-2']);
    expect(deletedOutboxIds).toEqual(['ob-1']);
  });

  it('usa un corte de 5 años (1825 días) hacia atrás desde `now`', async () => {
    const { prisma } = buildFakePrisma([], []);
    const now = new Date('2026-07-31T00:00:00.000Z');

    const report = await purgeExpiredData({ prisma: prisma as never, logger }, { dryRun: true, now });

    const diffDays = (now.getTime() - report.cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(1824.9);
    expect(diffDays).toBeLessThan(1825.1);
  });
});
