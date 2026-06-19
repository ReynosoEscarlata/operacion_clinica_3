import { Queue } from 'bullmq';

import { getRedisConnectionOptions } from '../config/redis.js';

export const APPOINTMENT_EXPIRATION_QUEUE = 'appointment-expiration';
export const EMAIL_NOTIFICATIONS_QUEUE = 'email-notifications';
export const APPOINTMENT_REMINDERS_QUEUE = 'appointment-reminders';

const connection = getRedisConnectionOptions();

export const appointmentExpirationQueue = new Queue(APPOINTMENT_EXPIRATION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  },
});

// Retries según la tabla de Colas y Retry de CLAUDE.md: 3 intentos,
// backoff exponencial, delay base 5000ms, con dead letter (removeOnFail en
// false para poder inspeccionar/mover los jobs agotados).
export const emailNotificationsQueue = new Queue(EMAIL_NOTIFICATIONS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// Retries según CLAUDE.md: 3 intentos, backoff exponencial, delay base
// 10000ms, con dead letter.
export const appointmentRemindersQueue = new Queue(APPOINTMENT_REMINDERS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export const closeQueues = async (): Promise<void> => {
  await appointmentExpirationQueue.close();
  await emailNotificationsQueue.close();
  await appointmentRemindersQueue.close();
};
