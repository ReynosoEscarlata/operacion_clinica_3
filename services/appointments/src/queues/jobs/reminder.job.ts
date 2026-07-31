import { randomUUID } from 'node:crypto';

import { buildSchedulerClient, createOneTimeSchedule, domainEventEnvelopeSchema } from '@clinica/messaging';

import { buildAwsConfig } from '../../config/aws.js';
import { env } from '../../config/env.js';
import { getTenantId } from '../../lib/tenant-context.js';

export const APPOINTMENT_REMINDER_EVENT_TYPE = 'AppointmentReminderDue';
const REMINDER_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

export interface ReminderJobData {
  appointmentId: string;
  requestId?: string;
}

const schedulerClient = buildSchedulerClient(buildAwsConfig());

// Reemplaza `appointmentRemindersQueue.add('send-reminder', data, { delay })`
// (BullMQ) -- ver expiration.job.ts para el porqué de EventBridge Scheduler.
export const enqueueAppointmentReminder = async (
  appointmentId: string,
  appointmentDateTime: Date,
  requestId?: string,
): Promise<void> => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error(`No se puede agendar el recordatorio de ${appointmentId} sin tenant ambiental`);
  }

  const executeAt = new Date(Math.max(Date.now(), appointmentDateTime.getTime() - REMINDER_LEAD_TIME_MS));

  const envelope = domainEventEnvelopeSchema.parse({
    eventId: randomUUID(),
    tenantId,
    type: APPOINTMENT_REMINDER_EVENT_TYPE,
    payload: requestId ? { appointmentId, requestId } : { appointmentId },
    publishedAt: new Date().toISOString(),
  });

  await createOneTimeSchedule({
    schedulerClient,
    groupName: env.SCHEDULER_GROUP_NAME,
    name: `reminder-${appointmentId}`,
    executeAt,
    targetArn: env.APPOINTMENT_REMINDERS_QUEUE_ARN,
    roleArn: env.SCHEDULER_EXECUTION_ROLE_ARN,
    input: envelope,
  });
};
