import type { AppointmentStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import { getRedisConnectionOptions } from '../../config/redis.js';
import type { Logger } from '../../lib/logger.js';
import type { AppointmentStateMachine } from '../../modules/appointments/state-machine.js';
import type { ExpirationJobData } from '../jobs/expiration.job.js';
import { APPOINTMENT_EXPIRATION_QUEUE } from '../queues.js';

interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface ExpirationJobDeps {
  findStatusById: (appointmentId: string) => Promise<AppointmentStatus | null>;
  stateMachine: Pick<AppointmentStateMachine, 'transition'>;
  logger: MinimalLogger;
}

export interface ExpirationWorkerDeps {
  findStatusById: (appointmentId: string) => Promise<AppointmentStatus | null>;
  stateMachine: AppointmentStateMachine;
  logger: Logger;
}

export const processExpirationJob = async (
  data: ExpirationJobData,
  deps: ExpirationJobDeps,
): Promise<void> => {
  const status = await deps.findStatusById(data.appointmentId);

  if (!status) {
    deps.logger.warn({ appointmentId: data.appointmentId }, 'Job de expiración: cita no encontrada');
    return;
  }

  if (status !== 'PENDING') {
    deps.logger.info(
      { appointmentId: data.appointmentId, currentStatus: status },
      'Job de expiración ignorado: la cita ya no está pendiente',
    );
    return;
  }

  await deps.stateMachine.transition(data.appointmentId, 'CANCELLED', {
    trigger: 'expiration',
    cancellationReason: 'No se completó el pago dentro de los 30 minutos',
  });
};

export const buildExpirationWorker = (deps: ExpirationWorkerDeps): Worker<ExpirationJobData> => {
  return new Worker<ExpirationJobData>(
    APPOINTMENT_EXPIRATION_QUEUE,
    async (job: Job<ExpirationJobData>) => {
      const jobLogger = deps.logger.child({
        queue: APPOINTMENT_EXPIRATION_QUEUE,
        jobId: job.id,
        ...(job.data.requestId ? { requestId: job.data.requestId } : {}),
      });

      await processExpirationJob(job.data, { ...deps, logger: jobLogger });
    },
    { connection: getRedisConnectionOptions() },
  );
};
