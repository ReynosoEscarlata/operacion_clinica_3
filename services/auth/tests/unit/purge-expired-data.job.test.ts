import { describe, expect, it, vi } from 'vitest';

import { purgeExpiredData } from '../../src/jobs/purge-expired-data.job.js';
import { logger } from '../../src/lib/logger.js';

const TENANT_A = 'a0000000-a000-a000-a000-a00000000001';

const buildFakePrisma = (candidates: unknown[]) => {
  const updatedUserIds: string[] = [];
  const deletedRefreshTokensForUserIds: string[] = [];

  const prisma = {
    $queryRaw: vi.fn(async () => candidates),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: async () => 0,
        user: {
          update: async ({ where }: { where: { id: string } }) => {
            updatedUserIds.push(where.id);
          },
        },
        refreshToken: {
          deleteMany: async ({ where }: { where: { userId: string } }) => {
            deletedRefreshTokensForUserIds.push(where.userId);
          },
        },
      };
      return fn(tx);
    }),
  };

  return { prisma, updatedUserIds, deletedRefreshTokensForUserIds };
};

describe('purgeExpiredData (Fase 5, ADR-016)', () => {
  it('dry-run reporta candidatos sin tocar nada', async () => {
    const { prisma, updatedUserIds, deletedRefreshTokensForUserIds } = buildFakePrisma([
      { id: 'user-1', tenantId: TENANT_A },
    ]);

    const report = await purgeExpiredData({ prisma: prisma as never, logger }, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.accountsFound).toBe(1);
    expect(report.accountsPurged).toBe(0);
    expect(updatedUserIds).toHaveLength(0);
    expect(deletedRefreshTokensForUserIds).toHaveLength(0);
  });

  it('modo real reemplaza passwordHash y borra los RefreshToken de cada candidato', async () => {
    const { prisma, updatedUserIds, deletedRefreshTokensForUserIds } = buildFakePrisma([
      { id: 'user-1', tenantId: TENANT_A },
      { id: 'user-2', tenantId: null },
    ]);

    const report = await purgeExpiredData({ prisma: prisma as never, logger }, { dryRun: false });

    expect(report.accountsPurged).toBe(2);
    expect(updatedUserIds).toEqual(['user-1', 'user-2']);
    expect(deletedRefreshTokensForUserIds).toEqual(['user-1', 'user-2']);
  });

  it('usa un corte de 30 días hacia atrás desde `now`', async () => {
    const { prisma } = buildFakePrisma([]);
    const now = new Date('2026-07-31T00:00:00.000Z');

    const report = await purgeExpiredData({ prisma: prisma as never, logger }, { dryRun: true, now });

    const diffDays = (now.getTime() - report.cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(29.9);
    expect(diffDays).toBeLessThan(30.1);
  });
});
