import type { Logger } from '../../lib/logger.js';
import type { AppointmentRepository } from '../appointments/appointments.repository.js';
import {
  emailNotificationsQueue,
  appointmentRemindersQueue,
} from '../../queues/queues.js';

export interface DeadLetterJob {
  id: string;
  queueName: string;
  jobName: string;
  data: Record<string, unknown>;
  failedReason: string;
  attemptsMade: number;
  timestamp: string;
}

export interface DeadLetterService {
  getFailedJobs: () => Promise<DeadLetterJob[]>;
  retryJob: (jobId: string, queueName: string) => Promise<void>;
  removeJob: (jobId: string, queueName: string) => Promise<void>;
}

export const buildDeadLetterService = (
  _appointmentRepository: AppointmentRepository,
  logger: Logger,
): DeadLetterService => {
  const queues = [emailNotificationsQueue, appointmentRemindersQueue];

  return {
    async getFailedJobs(): Promise<DeadLetterJob[]> {
      const allFailed: DeadLetterJob[] = [];

      for (const queue of queues) {
        const failedJobs = await queue.getFailed();

        for (const job of failedJobs) {
          allFailed.push({
            id: job.id ?? '',
            queueName: queue.name,
            jobName: job.name,
            data: job.data as Record<string, unknown>,
            failedReason: job.failedReason ?? 'Unknown',
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp?.toString() ?? new Date().toISOString(),
          });
        }
      }

      return allFailed.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    },

    async retryJob(jobId: string, queueName: string): Promise<void> {
      const queue = queues.find((q) => q.name === queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} no encontrada`);
      }

      const job = await queue.getJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} no encontrado en ${queueName}`);
      }

      await job.retry();
      logger.info({ jobId, queueName }, 'Job reiniciado desde dead-letter');
    },

    async removeJob(jobId: string, queueName: string): Promise<void> {
      const queue = queues.find((q) => q.name === queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} no encontrada`);
      }

      const job = await queue.getJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} no encontrado en ${queueName}`);
      }

      await job.remove();
      logger.info({ jobId, queueName }, 'Job removido de dead-letter');
    },
  };
};
