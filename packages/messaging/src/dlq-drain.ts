import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import type { DeadLetterableEvent, DeadLetterHandler } from './sqs-consumer.js';
import type { Logger } from './logger.js';

const DEFAULT_WAIT_TIME_SECONDS = 10;
const DEFAULT_MAX_MESSAGES = 10;
const GENERIC_DLQ_ERROR = 'Movido automáticamente al DLQ de SQS -- error original no disponible';

export interface DlqDrainDeps {
  sqsClient: SQSClient;
  dlqUrl: string;
  // Determinístico por definición de la redrive policy: un mensaje solo
  // llega a la DLQ física tras exactamente maxReceiveCount recepciones en
  // la cola origen -- no hace falta leer ningún atributo para saberlo.
  maxReceiveCount: number;
  logger: Logger;
  onDrain: DeadLetterHandler;
  waitTimeSeconds?: number;
}

// La DLQ física de SQS es una red de seguridad SECUNDARIA (crashes a mitad
// de proceso, mensajes que ni siquiera llegaron a processMessage) -- el
// camino esperado para "agotó reintentos" es el onDeadLetter dentro de
// sqs-consumer.ts, que conserva el error real. Este poller solo drena lo
// que haya llegado aquí por cualquier otra vía, sin tener el error
// original a mano.
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

const deleteMessage = async (deps: DlqDrainDeps, message: Message): Promise<void> => {
  if (!message.ReceiptHandle) return;
  await deps.sqsClient.send(
    new DeleteMessageCommand({ QueueUrl: deps.dlqUrl, ReceiptHandle: message.ReceiptHandle }),
  );
};

export const drainDlqOnce = async (deps: DlqDrainDeps): Promise<number> => {
  const result = await deps.sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: deps.dlqUrl,
      MaxNumberOfMessages: DEFAULT_MAX_MESSAGES,
      WaitTimeSeconds: deps.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS,
    }),
  );

  const messages = result.Messages ?? [];

  for (const message of messages) {
    const event = bestEffortEvent(message.Body);
    deps.logger.warn(
      { eventId: event.eventId, type: event.type },
      'Mensaje drenado de la DLQ física de SQS (sin error original disponible)',
    );
    await deps.onDrain(event, GENERIC_DLQ_ERROR, deps.maxReceiveCount);
    await deleteMessage(deps, message);
  }

  return messages.length;
};

export const startDlqDrain = (deps: DlqDrainDeps, intervalMs = 5000): (() => void) => {
  let stopped = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await drainDlqOnce(deps);
      } catch (error) {
        deps.logger.error({ err: error }, 'Error en el drenado de la DLQ física');
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  };

  void loop();

  return () => {
    stopped = true;
  };
};
