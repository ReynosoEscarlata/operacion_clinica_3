import { appointmentNoShowQueue } from '../queues.js';

export interface NoShowJobData {
  executedAt: string;
}

// Job repeatable que corre cada 15 minutos
export const scheduleNoShowJob = async (): Promise<void> => {
  await appointmentNoShowQueue.add('check-noshow', { executedAt: new Date().toISOString() }, {
    repeat: {
      pattern: '*/15 * * * *', // Cada 15 minutos
    },
  });
};
