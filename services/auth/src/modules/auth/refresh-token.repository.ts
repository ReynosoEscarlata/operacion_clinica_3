import { createHash, randomBytes } from 'node:crypto';

import type { PrismaClient, RefreshToken } from '@prisma/client';

import { env } from '../../config/env.js';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface IssuedRefreshToken {
  plain: string;
  record: RefreshToken;
}

export interface RefreshTokenRepository {
  issue: (userId: string) => Promise<IssuedRefreshToken>;
  findActiveByToken: (plain: string) => Promise<RefreshToken | null>;
  revoke: (id: string) => Promise<void>;
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async issue(userId: string): Promise<IssuedRefreshToken> {
    const plain = randomBytes(32).toString('hex');
    const tokenHash = hashToken(plain);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

    const record = await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    return { plain, record };
  }

  async findActiveByToken(plain: string): Promise<RefreshToken | null> {
    const tokenHash = hashToken(plain);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!record || record.revokedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return record;
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}

export const buildRefreshTokenRepository = (prisma: PrismaClient): RefreshTokenRepository =>
  new PrismaRefreshTokenRepository(prisma);
