import { randomUUID } from 'node:crypto';

import { CreateQueueCommand, DeleteQueueCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { buildSqsClient, pollQueueOnce, type DeadLetterHandler, type EventHandler } from '@clinica/messaging';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAwsConfig } from '../../src/config/aws.js';
import { logger } from '../../src/lib/logger.js';

const sqsClient = buildSqsClient(buildAwsConfig());

describe('Dead-letter de eventos de dominio (Appointments, SQS real vía LocalStack)', () => {
  let queueUrl: string;

  beforeEach(async () => {
    // VisibilityTimeout bajo para no esperar de verdad entre reintentos.
    const queue = await sqsClient.send(
      new CreateQueueCommand({ QueueName: `test-appointments-dlq-${randomUUID()}`, Attributes: { VisibilityTimeout: '1' } }),
    );
    queueUrl = queue.QueueUrl as string;
  });

  afterEach(async () => {
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
  });

  it('un evento que siempre falla agota sus reintentos y se envía a dead-letter con el error real', async () => {
    const alwaysFails: EventHandler = async () => {
      throw new Error('handler roto a propósito');
    };
    const onDeadLetter: DeadLetterHandler = vi.fn().mockResolvedValue(undefined);

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          eventId: randomUUID(),
          tenantId: randomUUID(),
          type: 'SomeEvent',
          payload: { marker: 'dlq-test' },
          publishedAt: new Date().toISOString(),
        }),
      }),
    );

    const deps = {
      sqsClient,
      queueUrl,
      logger,
      handlers: { SomeEvent: alwaysFails },
      onDeadLetter,
      maxReceiveCount: 2,
    };

    // Primer receive (ApproximateReceiveCount=1): por debajo del máximo, no
    // se manda a dead-letter todavía.
    await pollQueueOnce({ ...deps, waitTimeSeconds: 2 });
    expect(onDeadLetter).not.toHaveBeenCalled();

    // Espera a que expire la visibilidad (1s) para que SQS reentregue el
    // mismo mensaje con ApproximateReceiveCount=2 -- el último intento
    // permitido.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await pollQueueOnce({ ...deps, waitTimeSeconds: 2 });

    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(onDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SomeEvent', payload: { marker: 'dlq-test' } }),
      expect.any(Error),
      2,
    );
  });

  it('un evento sin handler registrado se borra sin error (tipo desconocido se ignora)', async () => {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          eventId: randomUUID(),
          tenantId: randomUUID(),
          type: 'TipoSinManejador',
          payload: { foo: 'bar' },
          publishedAt: new Date().toISOString(),
        }),
      }),
    );

    const processed = await pollQueueOnce({ sqsClient, queueUrl, logger, handlers: {}, waitTimeSeconds: 2 });

    expect(processed).toBe(1);
  });
});
