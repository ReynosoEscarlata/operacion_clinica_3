import { randomUUID } from 'node:crypto';

import { CreateTopicCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAwsConfig } from '../../src/config/aws.js';
import { prisma } from '../../src/config/prisma.js';
import { logger } from '../../src/lib/logger.js';
import { runOutboxRelayOnce } from '../../src/lib/outbox-relay.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';

const TEST_TENANT_ID = '44444444-4444-4444-4444-444444444444';

describe('Outbox relay (Payments, SNS real vía LocalStack)', () => {
  const snsClient = new SNSClient(buildAwsConfig());
  const sqsClient = new SQSClient(buildAwsConfig());
  let topicArn: string;
  let queueUrl: string;

  beforeAll(async () => {
    const topic = await snsClient.send(new CreateTopicCommand({ Name: `test-payments-relay-${randomUUID()}` }));
    topicArn = topic.TopicArn as string;

    const queue = await sqsClient.send(new CreateQueueCommand({ QueueName: `test-payments-relay-${randomUUID()}` }));
    queueUrl = queue.QueueUrl as string;
    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
    );
    await snsClient.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'sqs',
        Endpoint: attrs.Attributes?.['QueueArn'],
        Attributes: { RawMessageDelivery: 'true' },
      }),
    );
  });

  afterAll(async () => {
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('publica eventos no publicados a SNS y marca publishedAt, cruzando tenants', async () => {
    const marker = randomUUID();
    const event = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.outboxEvent.create({
        data: { tenantId: TEST_TENANT_ID, type: 'PaymentSucceeded', payload: { marker, appointmentId: 'apt-1' } },
      }),
    );

    const published = await runOutboxRelayOnce({ prisma, snsClient, topicArn, logger });
    expect(published).toBeGreaterThanOrEqual(1);

    const updated = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.outboxEvent.findUnique({ where: { id: event.id } }),
    );
    expect(updated?.publishedAt).not.toBeNull();

    // Otros archivos de test corren en paralelo contra el mismo Postgres --
    // se reintenta el receive unas pocas veces por si el relay recogió
    // eventos pendientes de esos otros archivos también.
    let match: Message | undefined;
    for (let attempt = 0; attempt < 5 && !match; attempt += 1) {
      const received = await sqsClient.send(
        new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 5, MaxNumberOfMessages: 10 }),
      );
      match = received.Messages?.find((message) => message.Body?.includes(marker));
    }
    expect(match).toBeDefined();
    const body = JSON.parse(match?.Body ?? '{}') as { type: string; tenantId: string };
    expect(body.type).toBe('PaymentSucceeded');
    expect(body.tenantId).toBe(TEST_TENANT_ID);
  });

  it('no vuelve a publicar un evento ya publicado', async () => {
    const marker = randomUUID();
    await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.outboxEvent.create({
        data: { tenantId: TEST_TENANT_ID, type: 'PaymentFailed', payload: { marker }, publishedAt: new Date() },
      }),
    );

    await runOutboxRelayOnce({ prisma, snsClient, topicArn, logger });

    const received = await sqsClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 2, MaxNumberOfMessages: 10 }),
    );
    const match = received.Messages?.find((message) => message.Body?.includes(marker));
    expect(match).toBeUndefined();
  });
});
