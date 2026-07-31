import { randomUUID } from 'node:crypto';

import { CreateQueueCommand, DeleteQueueCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { buildSqsClient, pollQueueOnce, type DeadLetterHandler } from '@clinica/messaging';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAwsConfig } from '../../src/config/aws.js';
import { prisma } from '../../src/config/prisma.js';
import type { EventHandler } from '../../src/lib/handler-types.js';
import { logger } from '../../src/lib/logger.js';

const sqsClient = buildSqsClient(buildAwsConfig());

describe('Dead-letter de eventos de dominio (Notifications, SQS real vía LocalStack)', () => {
  let queueUrl: string;

  beforeEach(async () => {
    // VisibilityTimeout bajo para no esperar de verdad entre reintentos.
    const queue = await sqsClient.send(
      new CreateQueueCommand({ QueueName: `test-notifications-dlq-${randomUUID()}`, Attributes: { VisibilityTimeout: '1' } }),
    );
    queueUrl = queue.QueueUrl as string;
  });

  afterEach(async () => {
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
  });

  afterAll(async () => {
    await prisma.$disconnect();
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
      handlers: { SomeEvent: alwaysFails as never },
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
});
