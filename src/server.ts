import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { initSentry, registerProcessErrorHandlers } from './config/sentry.js';
import { logger } from './lib/logger.js';
import { buildStateMachine } from './modules/appointments/state-machine.js';
import { buildAppointmentRepository } from './modules/appointments/appointments.repository.js';
import { buildEmailService } from './modules/notifications/email.service.js';
import { buildDeadLetterService } from './modules/admin/dead-letter.service.js';
import { closeQueues } from './queues/queues.js';
import { buildExpirationWorker } from './queues/workers/expiration.worker.js';
import { buildEmailWorker } from './queues/workers/email.worker.js';
import { buildReminderWorker } from './queues/workers/reminder.worker.js';
import { buildNoShowWorker } from './queues/workers/noshow.worker.js';
import { scheduleNoShowJob } from './queues/jobs/noshow.job.js';

const start = async (): Promise<void> => {
  initSentry();
  registerProcessErrorHandlers();

  const stateMachine = buildStateMachine(prisma, logger);
  const appointmentRepository = buildAppointmentRepository(prisma);
  const emailService = buildEmailService(logger);
  const deadLetterService = buildDeadLetterService(appointmentRepository, logger);

  const app = buildApp({
    admin: { deadLetterService },
  });

  // Construir un objeto de repositorio de pacientes para los workers
  const patientRepository = {
    findById: async (id: string) => {
      const patient = await prisma.patient.findUnique({
        where: { id },
        select: { id: true, email: true, name: true },
      });
      return patient;
    },
  };

  // Construir los workers
  const expirationWorker = buildExpirationWorker({
    findStatusById: async (appointmentId) => {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { status: true },
      });
      return appointment?.status ?? null;
    },
    stateMachine,
    logger,
  });

  const emailWorker = buildEmailWorker({
    appointmentRepository,
    patientRepository,
    emailService,
    logger,
  });

  const reminderWorker = buildReminderWorker({
    appointmentRepository,
    patientRepository,
    emailService,
    stateMachine,
    logger,
  });

  const noShowWorker = buildNoShowWorker({
    appointmentRepository,
    stateMachine,
    logger,
  });

  // Programar el job de noshow
  await scheduleNoShowJob();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Iniciando apagado del servidor');

    await app.close();
    await expirationWorker.close();
    await emailWorker.close();
    await reminderWorker.close();
    await noShowWorker.close();
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();

    logger.info({ signal }, 'Servidor apagado correctamente');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, 'Servidor arrancado');
  } catch (error) {
    logger.error({ err: error }, 'Error al arrancar el servidor');
    process.exit(1);
  }
};

void start();
