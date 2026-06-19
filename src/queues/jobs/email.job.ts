import { emailNotificationsQueue } from '../queues.js';

export type EmailJobType = 'confirmation' | 'payment-failed' | 'cancellation';

export interface EmailJobData {
  type: EmailJobType;
  appointmentId: string;
  requestId?: string;
}

export const enqueueEmailJob = async (
  type: EmailJobType,
  appointmentId: string,
  requestId?: string,
): Promise<void> => {
  const data: EmailJobData = requestId ? { type, appointmentId, requestId } : { type, appointmentId };
  await emailNotificationsQueue.add('send-email', data);
};
