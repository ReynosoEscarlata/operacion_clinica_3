import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import { getRedisConnectionOptions } from '../../config/redis.js';
import type { Logger } from '../../lib/logger.js';
import { requestContextStorage } from '../../lib/request-context.js';
import { runWithTenant } from '../../lib/tenant-context.js';
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

// Job de sistema, cross-tenant por naturaleza (escanea TODOS los tenants
// buscando candidatos vencidos) -- ver
// listRemindedBefore/list_reminded_appointments_before (SECURITY DEFINER),
// que devuelve solo id+tenantId, nunca la fila completa. Cada candidato se
// procesa DENTRO de su propio runWithTenant antes de leer/escribir
// cualquier otro dato -- nunca se opera con dos tenants mezclados en la
// misma operación.
export const processNoShowJob = async (data: NoShowJobData, deps: NoShowWorkerDeps): Promise<void> => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const candidates = await deps.appointmentRepository.listRemindedBefore(oneHourAgo);

  if (candidates.length === 0) {
    deps.logger.info({ jobExecutedAt: data.executedAt }, 'No hay citas para marcar como no-show');
    return;
  }

  for (const candidate of candidates) {
    try {
      await runWithTenant(candidate.tenantId, async () => {
        const current = await deps.appointmentRepository.findStatusById(candidate.id);

        if (current !== 'REMINDED') {
          deps.logger.info(
            { appointmentId: candidate.id, currentStatus: current },
            'Cita ignorada: ya pasó de estado REMINDED',
          );
          return;
        }

        await deps.stateMachine.transition(candidate.id, 'NO_SHOW', { trigger: 'noshow-cron' });

        deps.logger.info({ appointmentId: candidate.id }, 'Cita marcada como NO_SHOW automáticamente');
      });
    } catch (error) {
      deps.logger.error({ err: error, appointmentId: candidate.id }, 'Error al marcar cita como NO_SHOW');
    }
  }

  deps.logger.info(
    { processedCount: candidates.length, jobExecutedAt: data.executedAt },
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
          jobLogger.error({ err: error }, 'Error no capturado en job de no-show');
          // NO re-lanzar: este job es crítico y siempre debe completarse sin
          // error para evitar que el cron falle.
        }
      });
    },
    { connection: getRedisConnectionOptions() },
  );
};
