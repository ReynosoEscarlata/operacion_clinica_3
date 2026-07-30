import { randomUUID } from 'node:crypto';

import { CreateScheduleGroupCommand, GetScheduleCommand } from '@aws-sdk/client-scheduler';
import { CreateQueueCommand, DeleteQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSchedulerClient, buildSqsClient } from '../src/aws-clients.js';
import { createOneTimeSchedule } from '../src/scheduler.js';
import { LOCALSTACK_CONFIG } from './helpers/localstack.js';

// NOTA (spike documentado en el plan de Fase 3b): LocalStack Community
// acepta el control-plane completo de EventBridge Scheduler
// (CreateScheduleGroup/CreateSchedule/GetSchedule, tanto `at()` como
// `rate()`) pero NO ejecuta de verdad los schedules -- confirmado
// manualmente antes de escribir este archivo. Por eso este test verifica
// que el schedule se crea con los parámetros correctos, no que efectivamente
// se dispare (nadie testearía "esperar 24h a que dispare de verdad" ni
// siquiera contra AWS real).
describe('createOneTimeSchedule (EventBridge Scheduler real vía LocalStack)', () => {
  const schedulerClient = buildSchedulerClient(LOCALSTACK_CONFIG);
  const sqsClient = buildSqsClient(LOCALSTACK_CONFIG);
  const groupName = `test-group-${randomUUID()}`;
  let queueUrl: string;
  let queueArn: string;

  beforeAll(async () => {
    await schedulerClient.send(new CreateScheduleGroupCommand({ Name: groupName }));

    const queue = await sqsClient.send(new CreateQueueCommand({ QueueName: `test-schedule-target-${randomUUID()}` }));
    queueUrl = queue.QueueUrl as string;
    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
    );
    queueArn = attrs.Attributes?.['QueueArn'] as string;
  });

  afterAll(async () => {
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
  });

  it('crea un schedule de una sola vez con la expresión at(), target y payload correctos', async () => {
    const name = `test-schedule-${randomUUID()}`;
    const executeAt = new Date(Date.now() + 30 * 60 * 1000);
    const roleArn = 'arn:aws:iam::000000000000:role/test-scheduler-role';

    await createOneTimeSchedule({
      schedulerClient,
      groupName,
      name,
      executeAt,
      targetArn: queueArn,
      roleArn,
      input: { type: 'AppointmentExpirationScheduled', appointmentId: 'apt-1' },
    });

    const schedule = await schedulerClient.send(new GetScheduleCommand({ Name: name, GroupName: groupName }));

    expect(schedule.ScheduleExpression).toBe(`at(${executeAt.toISOString().replace(/\.\d+Z$/, '')})`);
    expect(schedule.ActionAfterCompletion).toBe('DELETE');
    expect(schedule.Target?.Arn).toBe(queueArn);
    expect(schedule.Target?.RoleArn).toBe(roleArn);
    expect(JSON.parse(schedule.Target?.Input ?? '{}')).toEqual({
      type: 'AppointmentExpirationScheduled',
      appointmentId: 'apt-1',
    });
  });
});
