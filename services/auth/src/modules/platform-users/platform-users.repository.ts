import type { PrismaClient } from '@prisma/client';

export interface ActiveUserCountsRow {
  role: string;
  active_count: bigint;
}

export interface PlatformUsersRepository {
  getActiveUserCounts: () => Promise<Record<string, number>>;
}

// Fase 6 (ADR-017): dashboard ejecutivo -- platform_active_user_counts()
// (migración 20260731150000_add_platform_active_user_counts) es SECURITY
// DEFINER y agrega CROSS-TENANT a propósito, nunca dentro de withTenant().
// Solo conteos por rol, jamás una fila con email/nombre de un usuario.
export const buildPlatformUsersRepository = (prisma: PrismaClient): PlatformUsersRepository => ({
  getActiveUserCounts: async () => {
    const rows = await prisma.$queryRaw<ActiveUserCountsRow[]>`SELECT * FROM platform_active_user_counts()`;
    const byRole: Record<string, number> = {};
    for (const row of rows) {
      byRole[row.role] = Number(row.active_count);
    }
    return byRole;
  },
});
