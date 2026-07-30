import { randomUUID } from 'node:crypto';

import { CreateQueueCommand, DeleteQueueCommand, GetQueueAttributesCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSqsClient } from '../src/aws-clients.js';
import { drainDlqOnce } from '../src/dlq-drain.js';
import { LOCALSTACK_CONFIG } from './helpers/localstack.js';

const buildLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('drainDlqOnce (SQS real vía LocalStack)', () => {
  const sqsClient = buildSqsClient(LOCALSTACK_CONFIG);
  let dlqUrl: string;

  beforeEach(async () => {
    const queue = await sqsClient.send(new CreateQueueCommand({ QueueName: `test-dlq-${randomUUID()}` }));
    dlqUrl = queue.QueueUrl as string;
  });

  afterEach(async () => {
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: dlqUrl })).catch(() => undefined);
  });

  it('drena un mensaje de la DLQ física, llama a onDrain con attempts = maxReceiveCount y borra el mensaje', async () => {
    const eventId = randomUUID();
    const tenantId = randomUUID();
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: dlqUrl,
        MessageBody: JSON.stringify({ eventId, tenantId, type: 'PaymentSucceeded', payload: {} }),
      }),
    );

    const onDrain = vi.fn().mockResolvedValue(undefined);
    const drained = await drainDlqOnce({ sqsClient, dlqUrl, maxReceiveCount: 5, logger: buildLogger(), onDrain });

    expect(drained).toBe(1);
    expect(onDrain).toHaveBeenCalledWith(
      { eventId, tenantId, type: 'PaymentSucceeded', payload: { rawBody: expect.any(String) } },
      expect.any(String),
      5,
    );

    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['ApproximateNumberOfMessages'] }),
    );
    expect(attrs.Attributes?.['ApproximateNumberOfMessages']).toBe('0');
  });

  it('no hace nada si la DLQ está vacía', async () => {
    const onDrain = vi.fn();
    const drained = await drainDlqOnce({
      sqsClient,
      dlqUrl,
      maxReceiveCount: 5,
      logger: buildLogger(),
      onDrain,
      waitTimeSeconds: 1,
    });

    expect(drained).toBe(0);
    expect(onDrain).not.toHaveBeenCalled();
  });
});
