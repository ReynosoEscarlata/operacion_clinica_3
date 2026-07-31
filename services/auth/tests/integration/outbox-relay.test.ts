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
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { buildAwsConfig } from '../../src/config/aws.js';
import { prisma } from '../../src/config/prisma.js';
import { logger } from '../../src/lib/logger.js';
import { runOutboxRelayOnce } from '../../src/lib/outbox-relay.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';

const TEST_TENANT_ID = '77777777-7777-7777-7777-777777777777';
const TENANT_HEADERS = { 'x-internal-tenant-id': TEST_TENANT_ID, 'x-internal-user-role': 'clinic_owner' };

describe('Outbox relay (primer relay de Auth, SNS real vía LocalStack)', () => {
  let app: FastifyInstance;
  let createdId: string;
  const snsClient = new SNSClient(buildAwsConfig());
  const sqsClient = new SQSClient(buildAwsConfig());
  let topicArn: string;
  let queueUrl: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const topic = await snsClient.send(new CreateTopicCommand({ Name: `test-auth-relay-${randomUUID()}` }));
    topicArn = topic.TopicArn as string;

    const queue = await sqsClient.send(new CreateQueueCommand({ QueueName: `test-auth-relay-${randomUUID()}` }));
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
    if (createdId) {
      await withTenantId(prisma, TEST_TENANT_ID, (tx) => tx.user.delete({ where: { id: createdId } })).catch(
        () => undefined,
      );
    }
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  it('publica UserCreated a SNS y marca publishedAt (cierra backlog ítem 6: antes quedaba null para siempre)', async () => {
    const email = `relay-${randomUUID()}@clinica.test`;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: TENANT_HEADERS,
      payload: { email, name: 'Relay Test', role: 'RECEPTIONIST', password: 'super-secreta' },
    });
    expect(createResponse.statusCode).toBe(201);
    createdId = createResponse.json().id;

    const published = await runOutboxRelayOnce({ prisma, snsClient, topicArn, logger });
    expect(published).toBeGreaterThanOrEqual(1);

    const event = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
      tx.outboxEvent.findFirst({ where: { type: 'UserCreated' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(event?.publishedAt).not.toBeNull();
    expect((event?.payload as { userId?: string })?.userId).toBe(createdId);

    // Otros archivos de test corren en paralelo (vitest, workers separados)
    // contra el mismo Postgres -- la corrida del relay puede recoger
    // eventos pendientes de esos otros archivos también (cross-tenant por
    // diseño). Se reintenta el receive unas pocas veces para no depender de
    // que absolutamente todo llegue en la primera ronda bajo esa carga.
    let match: Message | undefined;
    for (let attempt = 0; attempt < 5 && !match; attempt += 1) {
      const received = await sqsClient.send(
        new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 5, MaxNumberOfMessages: 10 }),
      );
      match = received.Messages?.find((message) => message.Body?.includes(createdId));
    }
    expect(match).toBeDefined();
    const body = JSON.parse(match?.Body ?? '{}') as { type: string; tenantId: string };
    expect(body.type).toBe('UserCreated');
    expect(body.tenantId).toBe(TEST_TENANT_ID);
  });
});
