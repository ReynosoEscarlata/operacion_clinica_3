import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

const fakePrisma = {
  $queryRaw: async () => [{ 1: 1 }],
} as unknown as PrismaClient;

describe('GET /health', () => {
  it('responde ok cuando la base de datos responde', async () => {
    const app = await buildApp({ prisma: fakePrisma });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'notifications',
      checks: { database: 'ok' },
    });
  });
});
