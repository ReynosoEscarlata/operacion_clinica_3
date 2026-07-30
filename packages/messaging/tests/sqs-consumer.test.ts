import { randomUUID } from 'node:crypto';

import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSqsClient } from '../src/aws-clients.js';
import type { DomainEventEnvelope } from '../src/envelope.js';
import { pollQueueOnce } from '../src/sqs-consumer.js';
import { LOCALSTACK_CONFIG } from './helpers/localstack.js';

const buildLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const buildEnvelope = (overrides: Partial<DomainEventEnvelope> = {}): DomainEventEnvelope => ({
  eventId: randomUUID(),
  tenantId: randomUUID(),
  type: 'AppointmentCreated',
  payload: { appointmentId: randomUUID() },
  publishedAt: new Date().toISOString(),
  ...overrides,
});

describe('pollQueueOnce (SQS real vía LocalStack)', () => {
  const sqsClient = buildSqsClient(LOCALSTACK_CONFIG);
  let queueUrl: string;

  beforeEach(async () => {
    const queue = await sqsClient.send(
      new CreateQueueCommand({ QueueName: `test-consumer-${randomUUID()}`, Attributes: { VisibilityTimeout: '2' } }),
    );
    queueUrl = queue.QueueUrl as string;
  });

  afterEach(async () => {
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
  });

  it('procesa un mensaje válido, invoca el handler y borra el mensaje', async () => {
    const envelope = buildEnvelope();
    await sqsClient.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(envelope) }));

    const handler = vi.fn().mockResolvedValue(undefined);
    const processed = await pollQueueOnce({
      sqsClient,
      queueUrl,
      logger: buildLogger(),
      handlers: { AppointmentCreated: handler },
    });

    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalledWith(envelope);

    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['ApproximateNumberOfMessages'] }),
    );
    expect(attrs.Attributes?.['ApproximateNumberOfMessages']).toBe('0');
  });

  it('si no hay handler para el type, borra el mensaje sin fallar (mismo comportamiento que event-consumer.ts con Redis)', async () => {
    const envelope = buildEnvelope({ type: 'TipoSinHandler' });
    await sqsClient.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(envelope) }));

    const processed = await pollQueueOnce({ sqsClient, queueUrl, logger: buildLogger(), handlers: {} });
    expect(processed).toBe(1);
  });

  it('si el handler falla por debajo de maxReceiveCount, no borra el mensaje (se reintentará)', async () => {
    const envelope = buildEnvelope();
    await sqsClient.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(envelope) }));

    const handler = vi.fn().mockRejectedValue(new Error('falla simulada'));
    const onDeadLetter = vi.fn();
    const processed = await pollQueueOnce({
      sqsClient,
      queueUrl,
      logger: buildLogger(),
      handlers: { AppointmentCreated: handler },
      onDeadLetter,
      maxReceiveCount: 5,
    });

    expect(processed).toBe(0);
    expect(onDeadLetter).not.toHaveBeenCalled();

    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessages'],
      }),
    );
    // El mensaje sigue existiendo en la cola (no se borró) -- o bien
    // "in flight" (no visible) o ya visible de nuevo si el visibility
    // timeout (2s) ya expiró para cuando se corre esta aserción.
    const notVisible = Number(attrs.Attributes?.['ApproximateNumberOfMessagesNotVisible'] ?? '0');
    const visible = Number(attrs.Attributes?.['ApproximateNumberOfMessages'] ?? '0');
    expect(notVisible + visible).toBeGreaterThanOrEqual(1);
  });

  it('si el handler falla en el último intento permitido, llama a onDeadLetter con el error real y borra el mensaje', async () => {
    const envelope = buildEnvelope();
    await sqsClient.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(envelope) }));

    const boom = new Error('falla final');
    const handler = vi.fn().mockRejectedValue(boom);
    const onDeadLetter = vi.fn().mockResolvedValue(undefined);

    // maxReceiveCount: 1 -- el primer receive ya es "el último intento
    // permitido" (ApproximateReceiveCount arranca en 1).
    await pollQueueOnce({
      sqsClient,
      queueUrl,
      logger: buildLogger(),
      handlers: { AppointmentCreated: handler },
      onDeadLetter,
      maxReceiveCount: 1,
    });

    expect(onDeadLetter).toHaveBeenCalledWith(envelope, boom, 1);

    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['ApproximateNumberOfMessages'] }),
    );
    expect(attrs.Attributes?.['ApproximateNumberOfMessages']).toBe('0');
  });

  it('un mensaje con envelope inválido (sin tenantId) nunca invoca ningún handler, va directo a dead-letter', async () => {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ eventId: randomUUID(), type: 'AppointmentCreated', payload: {} }),
      }),
    );

    const handler = vi.fn();
    const onDeadLetter = vi.fn().mockResolvedValue(undefined);

    await pollQueueOnce({
      sqsClient,
      queueUrl,
      logger: buildLogger(),
      handlers: { AppointmentCreated: handler },
      onDeadLetter,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    const [event, , attempts] = onDeadLetter.mock.calls[0] as [unknown, unknown, number];
    expect(attempts).toBe(1);
    expect((event as { tenantId: string | null }).tenantId).toBeNull();

    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['ApproximateNumberOfMessages'] }),
    );
    expect(attrs.Attributes?.['ApproximateNumberOfMessages']).toBe('0');
  });
});
