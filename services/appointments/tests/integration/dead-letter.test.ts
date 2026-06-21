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

const publishToStream = async (type: string, payload: Record<string, unknown>): Promise<string> => {
  const eventId = randomUUID();
  await redis.xadd(DOMAIN_EVENTS_STREAM, '*', 'eventId', eventId, 'type', type, 'payload', JSON.stringify(payload));
  return eventId;
};

describe('Dead-letter de eventos de dominio (Redis Streams real)', () => {
  beforeAll(async () => {
    await ensureConsumerGroup(redis, GROUP, '$');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('un evento que siempre falla agota sus reintentos, se manda a dead-letter y se ack-ea', async () => {
    const alwaysFails: EventHandler = async () => {
      throw new Error('handler roto a propósito');
    };
    const onDeadLetter: DeadLetterHandler = vi.fn().mockResolvedValue(undefined);

    await publishToStream('SomeEvent', { marker: 'dlq-test' });

    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const deps = {
      redis,
      groupName: GROUP,
      consumerName: 'dlq-consumer',
      logger,
      handlers: { SomeEvent: alwaysFails },
      onDeadLetter,
      maxAttempts: 3,
      // Sin esto el test tardaría DEFAULT_MIN_IDLE_MS (5s) reales por
      // reintento: un evento solo se reclama (XAUTOCLAIM) para reintentar
      // después de estar sin ACK al menos minIdleMs.
      minIdleMs: 20,
    };

    // 1er intento: lo entrega XREADGROUP '>' (nunca se había entregado).
    await runConsumerBatchOnce(deps, 200);
    expect(onDeadLetter).not.toHaveBeenCalled();

    // 2do y 3er intento: ya no es "nuevo", hay que esperar minIdleMs y
    // reclamarlo vía XAUTOCLAIM (lo que hace runConsumerBatchOnce primero).
    await wait(30);
    await runConsumerBatchOnce(deps, 200);
    expect(onDeadLetter).not.toHaveBeenCalled();

    await wait(30);
    await runConsumerBatchOnce(deps, 200);
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(onDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SomeEvent', payload: { marker: 'dlq-test' } }),
      expect.any(Error),
      3,
    );

    // Invariante real que importa: nada queda atascado en la Pending
    // Entries List del grupo tras mandarlo a dead-letter (el ACK del evento
    // ya se hizo). No se valida "processed === 0" porque ese conteo agrega
    // cualquier otra entry que el consumer reclame en la misma pasada y es
    // sensible a timing bajo carga (corriendo la suite completa en paralelo).
    const pendingSummary = (await redis.xpending(DOMAIN_EVENTS_STREAM, GROUP)) as
      | [number, string | null, string | null, unknown]
      | null;
    expect(pendingSummary?.[0] ?? 0).toBe(0);
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('un evento sin handler registrado se ack-ea sin error (tipo desconocido se ignora)', async () => {
    await publishToStream('TipoSinManejador', { foo: 'bar' });

    const processed = await runConsumerBatchOnce(
      { redis, groupName: GROUP, consumerName: 'dlq-consumer', logger, handlers: {} },
      200,
    );

    expect(processed).toBe(1);
  });
});
