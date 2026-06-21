import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import {
  ensureConsumerGroup,
  runConsumerBatchOnce,
  type DeadLetterHandler,
  type EventHandler,
} from '../../src/lib/event-consumer.js';
import { DOMAIN_EVENTS_STREAM } from '../../src/lib/outbox-relay.js';
import { logger } from '../../src/lib/logger.js';

const GROUP = `test-dlq-${randomUUID()}`;

const publishToStream = async (type: string, payload: Record<string, unknown>): Promise<void> => {
  await redis.xadd(
    DOMAIN_EVENTS_STREAM,
    '*',
    'eventId',
    randomUUID(),
    'type',
    type,
    'payload',
    JSON.stringify(payload),
  );
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Dead-letter de eventos de dominio (Notifications, Redis Streams real)', () => {
  beforeAll(async () => {
    await ensureConsumerGroup(redis, GROUP, '$');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('un evento que siempre falla agota sus reintentos y se envía a dead-letter', async () => {
    const alwaysFails: EventHandler = async () => {
      throw new Error('handler roto a propósito');
    };
    const onDeadLetter: DeadLetterHandler = vi.fn().mockResolvedValue(undefined);

    await publishToStream('SomeEvent', { marker: 'dlq-test' });

    const deps = {
      redis,
      groupName: GROUP,
      consumerName: 'dlq-consumer',
      logger,
      handlers: { SomeEvent: alwaysFails },
      onDeadLetter,
      maxAttempts: 2,
      minIdleMs: 20,
    };

    await runConsumerBatchOnce(deps, 200);
    expect(onDeadLetter).not.toHaveBeenCalled();

    await wait(30);
    await runConsumerBatchOnce(deps, 200);
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(onDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SomeEvent', payload: { marker: 'dlq-test' } }),
      expect.any(Error),
      2,
    );

    const pendingSummary = (await redis.xpending(DOMAIN_EVENTS_STREAM, GROUP)) as
      | [number, string | null, string | null, unknown]
      | null;
    expect(pendingSummary?.[0] ?? 0).toBe(0);
  });
});
