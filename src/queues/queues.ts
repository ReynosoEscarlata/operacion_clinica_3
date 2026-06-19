import { Queue } from 'bullmq';

import { getRedisConnectionOptions } from '../config/redis.js';

export const APPOINTMENT_EXPIRATION_QUEUE = 'appointment-expiration';

export const appointmentExpirationQueue = new Queue(APPOINTMENT_EXPIRATION_QUEUE, {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  },
});

export const closeQueues = async (): Promise<void> => {
  await appointmentExpirationQueue.close();
};
