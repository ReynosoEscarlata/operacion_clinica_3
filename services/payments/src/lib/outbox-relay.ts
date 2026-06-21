import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import type { Logger } from './logger.js';

// Nombre del stream compartido por todos los servicios (Payments,
// Appointments, Doctors, ...). Un solo stream con todos los tipos de
// evento — cada consumer filtra por `type` al procesar (ver ADR-002:
// el relay drena el Outbox de cada servicio a Redis Streams; este archivo
// es el lado productor).
export const DOMAIN_EVENTS_STREAM = 'domain-events';

export interface OutboxRelayDeps {
  prisma: PrismaClient;
  redis: Redis;
  logger: Logger;
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 50;

// Una sola pasada: lee eventos no publicados, los manda al stream y marca
// publishedAt. Expuesto por separado de startOutboxRelay para poder
// probarlo sin esperar a un setInterval.
export const runOutboxRelayOnce = async (deps: OutboxRelayDeps): Promise<number> => {
  const pending = await deps.prisma.outboxEvent.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: 'asc' },
    take: deps.batchSize ?? DEFAULT_BATCH_SIZE,
  });

  for (const event of pending) {
    await deps.redis.xadd(
      DOMAIN_EVENTS_STREAM,
      '*',
      'eventId',
      event.id,
      'type',
      event.type,
      'payload',
      JSON.stringify(event.payload),
    );

    await deps.prisma.outboxEvent.update({
      where: { id: event.id },
      data: { publishedAt: new Date() },
    });
  }

  if (pending.length > 0) {
    deps.logger.info({ count: pending.length }, 'Outbox relay: eventos publicados a Redis Streams');
  }

  return pending.length;
};

export const startOutboxRelay = (deps: OutboxRelayDeps, intervalMs = 2000): (() => void) => {
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    runOutboxRelayOnce(deps).catch((error: unknown) => {
      deps.logger.error({ err: error }, 'Error en el relay del Outbox');
    });
  };

  const timer = setInterval(tick, intervalMs);
  tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
};
