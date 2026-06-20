import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import { getRedisConnectionOptions } from '../../config/redis.js';
import type { Logger } from '../../lib/logger.js';
import { requestContextStorage } from '../../lib/request-context.js';
import type { AppointmentRepository } from '../../modules/appointments/appointments.repository.js';
import type { AppointmentStateMachine } from '../../modules/appointments/state-machine.js';
import type { EmailService } from '../../modules/notifications/email.service.js';
import type { ReminderJobData } from '../jobs/reminder.job.js';
import { APPOINTMENT_REMINDERS_QUEUE } from '../queues.js';

export interface ReminderWorkerDeps {
  appointmentRepository: AppointmentRepository;
  patientRepository: {
    findById: (id: string) => Promise<{ id: string; email: string; name: string } | null>;
  };
  emailService: EmailService;
  stateMachine: AppointmentStateMachine;
  logger: Logger;
}

export const processReminderJob = async (data: ReminderJobData, deps: ReminderWorkerDeps): Promise<void> => {
  const appointment = await deps.appointmentRepository.findById(data.appointmentId);

  if (!appointment) {
    throw new Error(`Cita no encontrada: ${data.appointmentId}`);
  }

  // Idempotencia: si ya fue recordada o transicionó de PAID, no hacer nada
  if (appointment.status !== 'PAID') {
    deps.logger.info(
      { appointmentId: data.appointmentId, currentStatus: appointment.status },
      'Job de recordatorio ignorado: cita no está en estado PAID',
    );
    return;
  }

  const patient = await deps.patientRepository.findById(appointment.patientId);

  if (!patient) {
    throw new Error(`Paciente no encontrado: ${appointment.patientId}`);
  }

  // Enviar email de recordatorio
  await deps.emailService.sendReminderEmail(appointment, patient);

  // Transicionar a REMINDED
  await deps.stateMachine.transition(appointment.id, 'REMINDED', {
    trigger: 'reminder-job',
    eventType: 'REMINDER_SENT',
  });
};

export const buildReminderWorker = (deps: ReminderWorkerDeps): Worker<ReminderJobData> => {
  return new Worker<ReminderJobData>(
    APPOINTMENT_REMINDERS_QUEUE,
    async (job: Job<ReminderJobData>) => {
      const jobLogger = deps.logger.child({
        queue: APPOINTMENT_REMINDERS_QUEUE,
        jobId: job.id,
        jobAttempt: job.attemptsMade + 1,
        jobMaxAttempts: job.opts.attempts,
        ...(job.data.requestId ? { requestId: job.data.requestId } : {}),
      });

      await requestContextStorage.run({ requestId: job.data.requestId ?? String(job.id) }, async () => {
        try {
          await processReminderJob(job.data, { ...deps, logger: jobLogger });
        } catch (error) {
          jobLogger.error(
            { err: error, appointmentId: job.data.appointmentId },
            'Error al procesar reminder job',
          );
          throw error; // Re-lanzar para que BullMQ maneje el retry
        }
      });
    },
    { connection: getRedisConnectionOptions() },
  );
};
