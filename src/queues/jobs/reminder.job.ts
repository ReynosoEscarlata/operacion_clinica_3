import { appointmentRemindersQueue } from '../queues.js';

const REMINDER_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

export interface ReminderJobData {
  appointmentId: string;
  requestId?: string;
}

export const enqueueAppointmentReminder = async (
  appointmentId: string,
  appointmentDateTime: Date,
  requestId?: string,
): Promise<void> => {
  const delay = Math.max(0, appointmentDateTime.getTime() - REMINDER_LEAD_TIME_MS - Date.now());
  const data: ReminderJobData = requestId ? { appointmentId, requestId } : { appointmentId };

  await appointmentRemindersQueue.add('send-reminder', data, { delay });
};
