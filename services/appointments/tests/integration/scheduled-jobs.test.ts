import { randomUUID } from 'node:crypto';

import { GetScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { describe, expect, it } from 'vitest';

import { buildAwsConfig } from '../../src/config/aws.js';
import { env } from '../../src/config/env.js';
import { runWithTenant } from '../../src/lib/tenant-context.js';
import { enqueueAppointmentExpiration } from '../../src/queues/jobs/expiration.job.js';
import { enqueueAppointmentReminder } from '../../src/queues/jobs/reminder.job.js';

// NOTA (ver packages/messaging/tests/scheduler.test.ts): LocalStack
// Community acepta CreateSchedule pero no lo ejecuta de verdad -- esto
// verifica que enqueueAppointmentExpiration/enqueueAppointmentReminder
// arman el schedule con el target/envelope correctos, no que dispare.
describe('enqueueAppointmentExpiration/enqueueAppointmentReminder (EventBridge Scheduler real vía LocalStack)', () => {
  const schedulerClient = new SchedulerClient(buildAwsConfig());
  const TENANT_ID = '99999999-9999-9999-9999-999999999999';

  it('agenda la expiración con tenantId/type/payload correctos, apuntando a la cola de expiration', async () => {
    const appointmentId = randomUUID();

    await runWithTenant(TENANT_ID, () => enqueueAppointmentExpiration(appointmentId, 'req-1'));

    const schedule = await schedulerClient.send(
      new GetScheduleCommand({ Name: `expiration-${appointmentId}`, GroupName: env.SCHEDULER_GROUP_NAME }),
    );

    expect(schedule.Target?.Arn).toBe(env.APPOINTMENT_EXPIRATION_QUEUE_ARN);
    expect(schedule.ActionAfterCompletion).toBe('DELETE');
    const input = JSON.parse(schedule.Target?.Input ?? '{}');
    expect(input.tenantId).toBe(TENANT_ID);
    expect(input.type).toBe('AppointmentExpirationDue');
    expect(input.payload).toEqual({ appointmentId, requestId: 'req-1' });
  });

  it('agenda el recordatorio 24h antes de la cita, apuntando a la cola de reminders', async () => {
    const appointmentId = randomUUID();
    const dateTime = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await runWithTenant(TENANT_ID, () => enqueueAppointmentReminder(appointmentId, dateTime));

    const schedule = await schedulerClient.send(
      new GetScheduleCommand({ Name: `reminder-${appointmentId}`, GroupName: env.SCHEDULER_GROUP_NAME }),
    );

    expect(schedule.Target?.Arn).toBe(env.APPOINTMENT_REMINDERS_QUEUE_ARN);
    const input = JSON.parse(schedule.Target?.Input ?? '{}');
    expect(input.tenantId).toBe(TENANT_ID);
    expect(input.type).toBe('AppointmentReminderDue');
    expect(input.payload).toEqual({ appointmentId });

    const expectedExecuteAt = new Date(dateTime.getTime() - 24 * 60 * 60 * 1000);
    expect(schedule.ScheduleExpression).toBe(`at(${expectedExecuteAt.toISOString().replace(/\.\d+Z$/, '')})`);
  });

  it('lanza si se llama fuera de un tenant ambiental', async () => {
    await expect(enqueueAppointmentExpiration(randomUUID())).rejects.toThrow('sin tenant ambiental');
  });
});
