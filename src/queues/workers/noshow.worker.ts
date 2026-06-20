import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import { getRedisConnectionOptions } from '../../config/redis.js';
import type { Logger } from '../../lib/logger.js';
import { requestContextStorage } from '../../lib/request-context.js';
import type { AppointmentRepository } from '../../modules/appointments/appointments.repository.js';
import type { AppointmentStateMachine } from '../../modules/appointments/state-machine.js';
import { APPOINTMENT_NOSHOW_QUEUE } from '../queues.js';

export interface NoShowWorkerDeps {
  appointmentRepository: AppointmentRepository;
  stateMachine: AppointmentStateMachine;
  logger: Logger;
}

export interface NoShowJobData {
  executedAt: string;
}

export const processNoShowJob = async (data: NoShowJobData, deps: NoShowWorkerDeps): Promise<void> => {
  // Buscar citas en estado REMINDED cuya hora ya pasó hace más de 1 hora
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const appointments = await deps.appointmentRepository.list({
    status: 'REMINDED',
    dateRange: { start: new Date(0), end: oneHourAgo },
  });

  if (appointments.length === 0) {
    deps.logger.info(
      { jobExecutedAt: data.executedAt },
      'No hay citas para marcar como no-show',
    );
    return;
  }

  // Procesar cada cita
  for (const appointment of appointments) {
    try {
      // Verificar de nuevo antes de transicionar (idempotencia)
      const current = await deps.appointmentRepository.findStatusById(appointment.id);

      if (current !== 'REMINDED') {
        deps.logger.info(
          { appointmentId: appointment.id, currentStatus: current },
          'Cita ignorada: ya pasó de estado REMINDED',
        );
        continue;
      }

      await deps.stateMachine.transition(appointment.id, 'NO_SHOW', {
        trigger: 'noshow-cron',
      });

      deps.logger.info(
        { appointmentId: appointment.id },
        'Cita marcada como NO_SHOW automáticamente',
      );
    } catch (error) {
      deps.logger.error(
        { err: error, appointmentId: appointment.id },
        'Error al marcar cita como NO_SHOW',
      );
    }
  }

  deps.logger.info(
    { processedCount: appointments.length, jobExecutedAt: data.executedAt },
    'Job de no-show completado',
  );
};

export const buildNoShowWorker = (deps: NoShowWorkerDeps): Worker<NoShowJobData> => {
  return new Worker<NoShowJobData>(
    APPOINTMENT_NOSHOW_QUEUE,
    async (job: Job<NoShowJobData>) => {
      const jobLogger = deps.logger.child({
        queue: APPOINTMENT_NOSHOW_QUEUE,
        jobId: job.id,
        requestId: String(job.id),
      });

      await requestContextStorage.run({ requestId: String(job.id) }, async () => {
        try {
          await processNoShowJob(job.data, { ...deps, logger: jobLogger });
        } catch (error) {
          jobLogger.error(
            { err: error },
            'Error no capturado en job de no-show',
          );
          // NO re-lanzar: este job es crítico y siempre debe completarse sin error
          // para evitar que el cron falle
        }
      });
    },
    { connection: getRedisConnectionOptions() },
  );
};
