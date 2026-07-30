import { randomUUID } from 'node:crypto';

import { CreateTopicCommand, SubscribeCommand } from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSnsClient, buildSqsClient } from '../src/aws-clients.js';
import { MissingTenantIdError } from '../src/envelope.js';
import { publishDomainEvent } from '../src/sns-publisher.js';
import { LOCALSTACK_CONFIG } from './helpers/localstack.js';

describe('publishDomainEvent (SNS -> SQS real vía LocalStack)', () => {
  const snsClient = buildSnsClient(LOCALSTACK_CONFIG);
  const sqsClient = buildSqsClient(LOCALSTACK_CONFIG);
  let topicArn: string;
  let queueUrl: string;

  beforeAll(async () => {
    const topicName = `test-topic-${randomUUID()}`;
    const topic = await snsClient.send(new CreateTopicCommand({ Name: topicName }));
    topicArn = topic.TopicArn as string;

    const queue = await sqsClient.send(new CreateQueueCommand({ QueueName: `test-queue-${randomUUID()}` }));
    queueUrl = queue.QueueUrl as string;
    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
    );
    const queueArn = attrs.Attributes?.['QueueArn'] as string;

    await snsClient.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'sqs',
        Endpoint: queueArn,
        Attributes: { RawMessageDelivery: 'true' },
      }),
    );
  });

  afterAll(async () => {
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
  });

  it('publica el envelope y llega tal cual (rawMessageDelivery) a la cola suscrita', async () => {
    const eventId = randomUUID();
    const tenantId = randomUUID();

    await publishDomainEvent(snsClient, topicArn, {
      eventId,
      tenantId,
      type: 'AppointmentCreated',
      payload: { appointmentId: randomUUID() },
    });

    const received = await sqsClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 10, MaxNumberOfMessages: 10 }),
    );

    const match = received.Messages?.find((message) => message.Body?.includes(eventId));
    expect(match).toBeDefined();
    const body = JSON.parse(match?.Body ?? '{}') as { eventId: string; tenantId: string; type: string };
    expect(body.eventId).toBe(eventId);
    expect(body.tenantId).toBe(tenantId);
    expect(body.type).toBe('AppointmentCreated');
  });

  it('nunca publica un evento sin tenantId (lanza antes de llamar a SNS)', async () => {
    await expect(
      publishDomainEvent(snsClient, topicArn, {
        eventId: randomUUID(),
        tenantId: null,
        type: 'AppointmentCreated',
        payload: {},
      }),
    ).rejects.toThrow(MissingTenantIdError);
  });
});
