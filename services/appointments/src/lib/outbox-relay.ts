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

interface OutboxEventRow {
  id: string;
  type: string;
  payload: unknown;
}

// Una sola pasada: lee eventos no publicados, los manda al stream y marca
// publishedAt. Expuesto por separado de startOutboxRelay para poder
// probarlo sin esperar a un setInterval.
//
// Cross-tenant por diseño (job de sistema, no una request de un tenant
// particular): usa las funciones SECURITY DEFINER
// list_unpublished_outbox_events/mark_outbox_event_published (ver
// migration.sql) en vez de `prisma.outboxEvent.*` directo -- con FORCE ROW
// LEVEL SECURITY activo y sin ningún app.current_tenant seteado en esta
// conexión, una query directa nunca vería ninguna fila y el relay dejaría
// de publicar eventos en silencio (bug real encontrado al construir el
// equivalente en Payments -- ver ese commit).
export const runOutboxRelayOnce = async (deps: OutboxRelayDeps): Promise<number> => {
  const pending = await deps.prisma.$queryRaw<OutboxEventRow[]>`
    SELECT * FROM list_unpublished_outbox_events(${deps.batchSize ?? DEFAULT_BATCH_SIZE}::int)
  `;

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

    await deps.prisma.$executeRaw`SELECT mark_outbox_event_published(${event.id}::uuid)`;
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
