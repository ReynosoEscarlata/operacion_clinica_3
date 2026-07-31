import { randomUUID } from 'node:crypto';

import { buildSchedulerClient, createOneTimeSchedule, domainEventEnvelopeSchema } from '@clinica/messaging';

import { buildAwsConfig } from '../../config/aws.js';
import { env } from '../../config/env.js';
import { getTenantId } from '../../lib/tenant-context.js';

export const APPOINTMENT_EXPIRATION_EVENT_TYPE = 'AppointmentExpirationDue';
export const APPOINTMENT_EXPIRATION_DELAY_MS = 30 * 60 * 1000;

export interface ExpirationJobData {
  appointmentId: string;
  requestId?: string;
}

const schedulerClient = buildSchedulerClient(buildAwsConfig());

// Reemplaza `appointmentExpirationQueue.add('expire', data, { delay })`
// (BullMQ) -- SQS DelaySeconds tope 900s no alcanza para 30min, de ahí
// EventBridge Scheduler (ADR-014). El schedule entrega el mensaje a la cola
// `appointment-expiration`, consumida vía @clinica/messaging igual que
// cualquier otra cola de eventos de dominio (el tenantId ya se conoce acá,
// no hace falta resolverlo de nuevo al consumir).
export const enqueueAppointmentExpiration = async (appointmentId: string, requestId?: string): Promise<void> => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error(`No se puede agendar la expiración de ${appointmentId} sin tenant ambiental`);
  }

  const envelope = domainEventEnvelopeSchema.parse({
    eventId: randomUUID(),
    tenantId,
    type: APPOINTMENT_EXPIRATION_EVENT_TYPE,
    payload: requestId ? { appointmentId, requestId } : { appointmentId },
    publishedAt: new Date().toISOString(),
  });

  await createOneTimeSchedule({
    schedulerClient,
    groupName: env.SCHEDULER_GROUP_NAME,
    name: `expiration-${appointmentId}`,
    executeAt: new Date(Date.now() + APPOINTMENT_EXPIRATION_DELAY_MS),
    targetArn: env.APPOINTMENT_EXPIRATION_QUEUE_ARN,
    roleArn: env.SCHEDULER_EXECUTION_ROLE_ARN,
    input: envelope,
  });
};
