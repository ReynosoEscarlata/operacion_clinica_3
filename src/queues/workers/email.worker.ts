import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import { getRedisConnectionOptions } from '../../config/redis.js';
import type { Logger } from '../../lib/logger.js';
import { requestContextStorage } from '../../lib/request-context.js';
import type { AppointmentRepository } from '../../modules/appointments/appointments.repository.js';
import type { EmailService } from '../../modules/notifications/email.service.js';
import type { EmailJobData } from '../jobs/email.job.js';
import { EMAIL_NOTIFICATIONS_QUEUE } from '../queues.js';

export interface EmailWorkerDeps {
  appointmentRepository: AppointmentRepository;
  patientRepository: {
    findById: (id: string) => Promise<{ id: string; email: string; name: string } | null>;
  };
  emailService: EmailService;
  logger: Logger;
}

export const processEmailJob = async (data: EmailJobData, deps: EmailWorkerDeps): Promise<void> => {
  const appointment = await deps.appointmentRepository.findById(data.appointmentId);

  if (!appointment) {
    throw new Error(`Cita no encontrada: ${data.appointmentId}`);
  }

  const patient = await deps.patientRepository.findById(appointment.patientId);

  if (!patient) {
    throw new Error(`Paciente no encontrado: ${appointment.patientId}`);
  }

  switch (data.type) {
    case 'confirmation':
      await deps.emailService.sendConfirmationEmail(appointment, patient);
      break;
    case 'payment-failed':
      await deps.emailService.sendPaymentFailedEmail(appointment, patient);
      break;
    case 'cancellation':
      await deps.emailService.sendCancellationEmail(appointment, patient);
      break;
    default:
      throw new Error(`Tipo de email desconocido: ${data.type}`);
  }

  // Registrar evento de email enviado
  await deps.appointmentRepository.addEvent(appointment.id, 'EMAIL_SENT', {
    emailType: data.type,
    sentAt: new Date(),
  });
};

export const buildEmailWorker = (deps: EmailWorkerDeps): Worker<EmailJobData> => {
  return new Worker<EmailJobData>(
    EMAIL_NOTIFICATIONS_QUEUE,
    async (job: Job<EmailJobData>) => {
      const jobLogger = deps.logger.child({
        queue: EMAIL_NOTIFICATIONS_QUEUE,
        jobId: job.id,
        jobAttempt: job.attemptsMade + 1,
        jobMaxAttempts: job.opts.attempts,
        ...(job.data.requestId ? { requestId: job.data.requestId } : {}),
      });

      await requestContextStorage.run({ requestId: job.data.requestId ?? String(job.id) }, async () => {
        try {
          await processEmailJob(job.data, { ...deps, logger: jobLogger });
        } catch (error) {
          jobLogger.error(
            { err: error, appointmentId: job.data.appointmentId, emailType: job.data.type },
            'Error al procesar email job',
          );
          throw error; // Re-lanzar para que BullMQ maneje el retry
        }
      });
    },
    { connection: getRedisConnectionOptions() },
  );
};
