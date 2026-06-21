import { appointmentExpirationQueue } from '../queues.js';

export interface ExpirationJobData {
  appointmentId: string;
  requestId?: string;
}

export const APPOINTMENT_EXPIRATION_DELAY_MS = 30 * 60 * 1000;

export const enqueueAppointmentExpiration = async (
  appointmentId: string,
  requestId?: string,
): Promise<void> => {
  const data: ExpirationJobData = requestId ? { appointmentId, requestId } : { appointmentId };

  await appointmentExpirationQueue.add('expire', data, {
    delay: APPOINTMENT_EXPIRATION_DELAY_MS,
  });
};
