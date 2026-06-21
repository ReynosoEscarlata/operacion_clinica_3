import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import { DOMAIN_EVENTS_STREAM, runOutboxRelayOnce } from '../../src/lib/outbox-relay.js';
import { logger } from '../../src/lib/logger.js';

describe('Outbox relay (Postgres + Redis Streams reales)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('publica eventos no publicados al stream y marca publishedAt', async () => {
    const marker = randomUUID();
    const event = await prisma.outboxEvent.create({
      data: { type: 'PaymentSucceeded', payload: { marker, appointmentId: 'apt-1' } },
    });

    const published = await runOutboxRelayOnce({ prisma, redis, logger });
    expect(published).toBeGreaterThanOrEqual(1);

    const updated = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
    expect(updated?.publishedAt).not.toBeNull();

    const entries = await redis.xrange(DOMAIN_EVENTS_STREAM, '-', '+');
    const match = entries.find(([, fields]) => fields.includes(JSON.stringify({ marker, appointmentId: 'apt-1' })));
    expect(match).toBeDefined();
  });

  it('no vuelve a publicar un evento ya publicado', async () => {
    const marker = randomUUID();
    await prisma.outboxEvent.create({
      data: { type: 'PaymentFailed', payload: { marker }, publishedAt: new Date() },
    });

    const published = await runOutboxRelayOnce({ prisma, redis, logger });

    const entries = await redis.xrange(DOMAIN_EVENTS_STREAM, '-', '+');
    const matches = entries.filter(([, fields]) => fields.includes(JSON.stringify({ marker })));
    expect(matches).toHaveLength(0);
    expect(published).toBeGreaterThanOrEqual(0);
  });
});
