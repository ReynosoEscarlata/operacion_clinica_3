import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import { parseEnvelope, type DomainEventEnvelope } from './envelope.js';
import type { Logger } from './logger.js';

export type EventHandler = (event: DomainEventEnvelope) => Promise<void>;

// A diferencia de DomainEventEnvelope (siempre válido cuando llega a un
// handler), lo que se manda a dead-letter puede venir de un mensaje que ni
// siquiera pudo parsearse -- de ahí que tenantId sea nullable y los demás
// campos sean "mejor esfuerzo".
export interface DeadLetterableEvent {
  eventId: string;
  tenantId: string | null;
  type: string;
  payload: Record<string, unknown>;
}

export type DeadLetterHandler = (
  event: DeadLetterableEvent,
  error: unknown,
  attempts: number,
) => Promise<void>;

const DEFAULT_MAX_RECEIVE_COUNT = 5;
const DEFAULT_WAIT_TIME_SECONDS = 10;
const DEFAULT_MAX_MESSAGES = 10;

export interface QueueConsumerDeps {
  sqsClient: SQSClient;
  queueUrl: string;
  logger: Logger;
  handlers: Record<string, EventHandler>;
  // Si no se provee, un evento que agota sus reintentos simplemente se
  // borra y se pierde -- mismo comportamiento (y misma advertencia) que
  // tenía event-consumer.ts con Redis Streams.
  onDeadLetter?: DeadLetterHandler;
  maxReceiveCount?: number;
  waitTimeSeconds?: number;
}

const bestEffortEvent = (rawBody: string | undefined): DeadLetterableEvent => {
  try {
    const parsed = JSON.parse(rawBody ?? '{}') as Record<string, unknown>;
    return {
      eventId: typeof parsed['eventId'] === 'string' ? parsed['eventId'] : 'unknown',
      tenantId: typeof parsed['tenantId'] === 'string' ? parsed['tenantId'] : null,
      type: typeof parsed['type'] === 'string' ? parsed['type'] : 'unknown',
      payload: { rawBody },
    };
  } catch {
    return { eventId: 'unknown', tenantId: null, type: 'unknown', payload: { rawBody } };
  }
};

const deleteMessage = async (deps: QueueConsumerDeps, message: Message): Promise<void> => {
  if (!message.ReceiptHandle) return;
  await deps.sqsClient.send(
    new DeleteMessageCommand({ QueueUrl: deps.queueUrl, ReceiptHandle: message.ReceiptHandle }),
  );
};

const processMessage = async (deps: QueueConsumerDeps, message: Message): Promise<boolean> => {
  const maxReceiveCount = deps.maxReceiveCount ?? DEFAULT_MAX_RECEIVE_COUNT;
  const receiveCount = Number(message.Attributes?.['ApproximateReceiveCount'] ?? '1');

  let envelope: DomainEventEnvelope;
  try {
    envelope = parseEnvelope(JSON.parse(message.Body ?? '{}'));
  } catch (error) {
    // Envelope estructuralmente inválido (JSON corrupto, tenantId ausente/
    // no-uuid, type vacío): nunca se invoca ningún handler, va directo a
    // dead-letter en el primer receive, cero reintentos -- ADR-014, "nunca
    // procesarlo por si acaso".
    deps.logger.error(
      { err: error, body: message.Body },
      'Mensaje con envelope inválido, va directo a dead-letter',
    );
    if (deps.onDeadLetter) {
      await deps.onDeadLetter(bestEffortEvent(message.Body), error, 1);
    }
    await deleteMessage(deps, message);
    return false;
  }

  try {
    const handler = deps.handlers[envelope.type];
    if (handler) {
      await handler(envelope);
    }
    await deleteMessage(deps, message);
    return true;
  } catch (error) {
    if (receiveCount < maxReceiveCount) {
      deps.logger.error(
        { err: error, eventId: envelope.eventId, type: envelope.type, receiveCount, maxReceiveCount },
        'Error al procesar evento de dominio, se reintentará (mensaje no borrado)',
      );
      return false;
    }

    // Último intento permitido: se llama a onDeadLetter todavía con el
    // error real en mano y se borra explícitamente -- nunca se deja que el
    // mensaje llegue a la DLQ física de SQS por esta vía, así se conserva
    // el error real (cosa que la DLQ física no puede devolver).
    deps.logger.error(
      { err: error, eventId: envelope.eventId, type: envelope.type, receiveCount },
      'Evento de dominio agotó sus reintentos, se envía a dead-letter',
    );
    if (deps.onDeadLetter) {
      await deps.onDeadLetter(envelope, error, receiveCount);
    }
    await deleteMessage(deps, message);
    return false;
  }
};

// Una sola pasada: expuesto por separado de startQueueConsumer para poder
// probarlo sin depender de un loop infinito.
export const pollQueueOnce = async (deps: QueueConsumerDeps): Promise<number> => {
  const result = await deps.sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: deps.queueUrl,
      MaxNumberOfMessages: DEFAULT_MAX_MESSAGES,
      WaitTimeSeconds: deps.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }),
  );

  const messages = result.Messages ?? [];
  let processed = 0;

  for (const message of messages) {
    const succeeded = await processMessage(deps, message);
    if (succeeded) {
      processed += 1;
    }
  }

  return processed;
};

export const startQueueConsumer = (deps: QueueConsumerDeps): (() => void) => {
  let stopped = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await pollQueueOnce(deps);
      } catch (error) {
        deps.logger.error({ err: error }, 'Error en el consumer de la cola');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  void loop();

  return () => {
    stopped = true;
  };
};
