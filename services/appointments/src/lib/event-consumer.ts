import type { Redis } from 'ioredis';

import type { Logger } from './logger.js';
import { DOMAIN_EVENTS_STREAM } from './outbox-relay.js';

export interface DomainEvent {
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

export type DeadLetterHandler = (
  event: DomainEvent,
  error: unknown,
  attempts: number,
) => Promise<void>;

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MIN_IDLE_MS = 5000;

export interface EventConsumerDeps {
  redis: Redis;
  groupName: string;
  consumerName: string;
  logger: Logger;
  handlers: Record<string, EventHandler>;
  // Llamado cuando un evento agota sus reintentos (ver getDeliveryCount):
  // el caller decide qué hacer (típicamente, persistir en su propia tabla
  // de dead-letter). Si no se provee, el evento simplemente se ack-ea y se
  // pierde tras agotar los intentos — ver advertencia en runConsumerBatchOnce.
  onDeadLetter?: DeadLetterHandler;
  maxAttempts?: number;
  // XREADGROUP con '>' solo entrega mensajes NUNCA entregados a este grupo
  // — un mensaje que falló y quedó sin ACK no vuelve a aparecer ahí. Hace
  // falta reclamarlo explícitamente vía XAUTOCLAIM una vez que pasó este
  // tiempo sin ACK (minIdleMs), para reintentarlo. Bajar este valor en
  // tests para no esperar de verdad.
  minIdleMs?: number;
}

const fieldsToRecord = (fields: string[]): Record<string, string> => {
  const record: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) {
      record[key] = value;
    }
  }
  return record;
};

export const ensureConsumerGroup = async (
  redis: Redis,
  groupName: string,
  startId = '0',
): Promise<void> => {
  try {
    await redis.xgroup('CREATE', DOMAIN_EVENTS_STREAM, groupName, startId, 'MKSTREAM');
  } catch (error) {
    // BUSYGROUP: el grupo ya existe — no es un error real, solo significa
    // que este consumer ya se registró en un arranque anterior.
    if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
      throw error;
    }
  }
};

// XPENDING en su forma extendida devuelve, por entry, cuántas veces fue
// entregado (delivery count) — es el contador que ya mantiene Redis,  no
// hace falta llevar uno propio en memoria (que se perdería en cada
// restart). Si no hay info de pending (caso raro), se asume 1ra entrega.
const getDeliveryCount = async (redis: Redis, groupName: string, entryId: string): Promise<number> => {
  const result = (await redis.xpending(
    DOMAIN_EVENTS_STREAM,
    groupName,
    entryId,
    entryId,
    1,
  )) as Array<[string, string, number, number]> | null;

  return result?.[0]?.[3] ?? 1;
};

const handleFailure = async (
  deps: EventConsumerDeps,
  domainEvent: DomainEvent,
  entryId: string,
  error: unknown,
): Promise<void> => {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attempts = await getDeliveryCount(deps.redis, deps.groupName, entryId);

  if (attempts < maxAttempts) {
    deps.logger.error(
      { err: error, entryId, type: domainEvent.type, attempts, maxAttempts },
      'Error al procesar evento de dominio, se reintentará (sin XACK)',
    );
    return;
  }

  deps.logger.error(
    { err: error, entryId, type: domainEvent.type, attempts },
    'Evento de dominio agotó sus reintentos, se envía a dead-letter',
  );
  if (deps.onDeadLetter) {
    await deps.onDeadLetter(domainEvent, error, attempts);
  }
  // Se hace ACK incluso sin handler exitoso: dejarlo sin ack para siempre
  // llenaría la Pending Entries List indefinidamente. Una vez en
  // dead-letter, el reproceso es manual (ver dead-letter routes), no
  // automático.
  await deps.redis.xack(DOMAIN_EVENTS_STREAM, deps.groupName, entryId);
};

const processEntry = async (
  deps: EventConsumerDeps,
  entryId: string,
  fields: string[],
): Promise<boolean> => {
  const record = fieldsToRecord(fields);
  const type = record['type'] ?? 'unknown';
  const domainEvent: DomainEvent = {
    eventId: record['eventId'] ?? entryId,
    type,
    payload: record['payload'] ? (JSON.parse(record['payload']) as Record<string, unknown>) : {},
  };

  try {
    const handler = deps.handlers[type];
    if (handler) {
      await handler(domainEvent);
    }
    await deps.redis.xack(DOMAIN_EVENTS_STREAM, deps.groupName, entryId);
    return true;
  } catch (error) {
    await handleFailure(deps, domainEvent, entryId, error);
    return false;
  }
};

// Reclama (XAUTOCLAIM) entries pendientes que lleven más de minIdleMs sin
// ACK — propios o de un consumer que murió sin confirmar — y los
// reprocesa. Es lo que de verdad reintenta un evento que falló: sin esto,
// '>' nunca lo volvería a entregar y quedaría atascado en la Pending
// Entries List para siempre.
const claimAndProcessStaleEntries = async (deps: EventConsumerDeps): Promise<number> => {
  const minIdleMs = deps.minIdleMs ?? DEFAULT_MIN_IDLE_MS;
  const result = await deps.redis.xautoclaim(
    DOMAIN_EVENTS_STREAM,
    deps.groupName,
    deps.consumerName,
    minIdleMs,
    '0-0',
    'COUNT',
    10,
  );

  const [, claimedEntries] = result as [string, Array<[string, string[]]>, string[]?];
  let processed = 0;

  for (const [entryId, fields] of claimedEntries) {
    const succeeded = await processEntry(deps, entryId, fields);
    if (succeeded) {
      processed += 1;
    }
  }

  return processed;
};

// Una sola pasada: reintenta entries vencidas (XAUTOCLAIM) y luego lee
// entries nuevas (XREADGROUP). Expuesto por separado de startEventConsumer
// para poder probarlo sin depender de un loop infinito.
export const runConsumerBatchOnce = async (
  deps: EventConsumerDeps,
  blockMs = 1000,
): Promise<number> => {
  let processed = await claimAndProcessStaleEntries(deps);

  const result = await deps.redis.xreadgroup(
    'GROUP',
    deps.groupName,
    deps.consumerName,
    'COUNT',
    10,
    'BLOCK',
    blockMs,
    'STREAMS',
    DOMAIN_EVENTS_STREAM,
    '>',
  );

  if (!result) {
    return processed;
  }

  const streams = result as Array<[string, Array<[string, string[]]>]>;

  for (const [, entries] of streams) {
    for (const [entryId, fields] of entries) {
      const succeeded = await processEntry(deps, entryId, fields);
      if (succeeded) {
        processed += 1;
      }
    }
  }

  return processed;
};

export const startEventConsumer = (deps: EventConsumerDeps): (() => void) => {
  let stopped = false;

  const loop = async (): Promise<void> => {
    await ensureConsumerGroup(deps.redis, deps.groupName);

    while (!stopped) {
      try {
        await runConsumerBatchOnce(deps);
      } catch (error) {
        deps.logger.error({ err: error }, 'Error en el consumer de eventos de dominio');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  void loop();

  return () => {
    stopped = true;
  };
};
