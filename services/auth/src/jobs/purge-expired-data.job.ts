import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { hashPassword } from '../lib/password.js';
import type { Logger } from '../lib/logger.js';
import { ACCOUNT_CREDENTIALS_RETENTION_DAYS } from '../lib/retention-policy.js';
import { withTenantId } from '../lib/tenant-scoped.js';

export interface PurgeReport {
  cutoff: Date;
  dryRun: boolean;
  accountsFound: number;
  accountsPurged: number;
}

interface PurgeCandidate {
  id: string;
  tenantId: string | null;
}

const computeCutoff = (now: Date): Date => {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - ACCOUNT_CREDENTIALS_RETENTION_DAYS);
  return cutoff;
};

export interface PurgeExpiredDataDeps {
  prisma: PrismaClient;
  logger: Logger;
}

// Fase 5 (ADR-016): job de purga de credenciales. passwordHash se
// reemplaza por el hash de un valor aleatorio descartado de inmediato --
// nunca se puede volver a verificar contra ninguna contraseña real, pero
// la columna NOT NULL queda satisfecha sin necesitar una migración de
// esquema. RefreshToken se borra por completo (no hay razón de negocio
// para retenerlos: la cuenta ya está dada de baja).
export const purgeExpiredData = async (
  deps: PurgeExpiredDataDeps,
  options: { dryRun: boolean; now?: Date },
): Promise<PurgeReport> => {
  const cutoff = computeCutoff(options.now ?? new Date());
  const { prisma, logger } = deps;

  const candidates = await prisma.$queryRaw<PurgeCandidate[]>`
    SELECT id, "tenantId" FROM list_users_before_credential_retention_cutoff(${cutoff})
  `;
  let accountsPurged = 0;

  if (!options.dryRun) {
    for (const candidate of candidates) {
      try {
        const unusableHash = await hashPassword(randomUUID());
        await withTenantId(prisma, candidate.tenantId, async (tx) => {
          await tx.user.update({ where: { id: candidate.id }, data: { passwordHash: unusableHash } });
          await tx.refreshToken.deleteMany({ where: { userId: candidate.id } });
        });
        accountsPurged += 1;
      } catch (error) {
        logger.error({ err: error, userId: candidate.id }, 'Error al purgar credenciales vencidas');
      }
    }
  }

  const report: PurgeReport = {
    cutoff,
    dryRun: options.dryRun,
    accountsFound: candidates.length,
    accountsPurged,
  };

  logger.info(report, options.dryRun ? 'Purga de credenciales (dry-run)' : 'Purga de credenciales completada');

  return report;
};
