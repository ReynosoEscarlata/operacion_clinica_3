import { createHash, randomBytes } from 'node:crypto';

import type { PrismaClient, RefreshToken } from '@prisma/client';

import { env } from '../../config/env.js';
import { withTenantId } from '../../lib/tenant-scoped.js';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface IssuedRefreshToken {
  plain: string;
  record: RefreshToken;
}

// Fila mínima para decidir si el refresh token es válido -- ver
// find_refresh_token_for_refresh en la migración (excepción deliberada a
// RLS, acotada a estas columnas, análoga a UserAuthLookup).
export interface RefreshTokenLookup {
  id: string;
  tenantId: string | null;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RefreshTokenRepository {
  /**
   * El tenantId ya debe estar resuelto (viene de UserAuthLookup/UserRefreshLookup)
   * -- issue() nunca lo infiere. `actorRole` (formato @clinica/authz, ver
   * users.mapper.ts) es obligatorio porque hasta un actor de tenant normal
   * pasa por la misma política RLS de dos ramas -- para un actor de
   * plataforma (tenantId null) es la única forma de que el INSERT pase la
   * rama NULL de la política.
   */
  issue: (userId: string, tenantId: string | null, actorRole: string) => Promise<IssuedRefreshToken>;
  /** Búsqueda cross-tenant intencional -- solo para el flujo de refresh. */
  findActiveByToken: (plain: string) => Promise<RefreshTokenLookup | null>;
  revoke: (id: string, tenantId: string | null, actorRole: string) => Promise<void>;
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async issue(userId: string, tenantId: string | null, actorRole: string): Promise<IssuedRefreshToken> {
    const plain = randomBytes(32).toString('hex');
    const tokenHash = hashToken(plain);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

    const record = await withTenantId(
      this.prisma,
      tenantId,
      (tx) => tx.refreshToken.create({ data: { userId, tenantId, tokenHash, expiresAt } }),
      actorRole,
    );

    return { plain, record };
  }

  async findActiveByToken(plain: string): Promise<RefreshTokenLookup | null> {
    const tokenHash = hashToken(plain);
    const rows = await this.prisma.$queryRaw<RefreshTokenLookup[]>`
      SELECT * FROM find_refresh_token_for_refresh(${tokenHash})
    `;
    const record = rows[0] ?? null;

    if (!record || record.revokedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return record;
  }

  async revoke(id: string, tenantId: string | null, actorRole: string): Promise<void> {
    await withTenantId(
      this.prisma,
      tenantId,
      (tx) => tx.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } }),
      actorRole,
    );
  }
}

export const buildRefreshTokenRepository = (prisma: PrismaClient): RefreshTokenRepository =>
  new PrismaRefreshTokenRepository(prisma);
