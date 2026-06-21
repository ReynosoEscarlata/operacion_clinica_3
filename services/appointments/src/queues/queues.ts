import { Queue } from 'bullmq';

import { getRedisConnectionOptions } from '../config/redis.js';

export const APPOINTMENT_EXPIRATION_QUEUE = 'appointment-expiration';
export const APPOINTMENT_REMINDERS_QUEUE = 'appointment-reminders';
export const APPOINTMENT_NOSHOW_QUEUE = 'appointment-noshow';

const connection = getRedisConnectionOptions();

// Estrategia de retry según CLAUDE.md (tabla de Colas y Retry), portada del
// monolito tal cual. La cola `email-notifications` del monolito no se
// porta: enviar el email es responsabilidad de Notifications, no de
// Appointments — esta cola ya no tiene motivo de existir aquí.
export const appointmentExpirationQueue = new Queue(APPOINTMENT_EXPIRATION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  },
});

export const appointmentRemindersQueue = new Queue(APPOINTMENT_REMINDERS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// Job repeatable (cron) cada 15 minutos. Sin reintentos: si falla, la
// siguiente ejecución del cron lo recoge.
export const appointmentNoShowQueue = new Queue(APPOINTMENT_NOSHOW_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  },
});

export const closeQueues = async (): Promise<void> => {
  await appointmentExpirationQueue.close();
  await appointmentRemindersQueue.close();
  await appointmentNoShowQueue.close();
};
