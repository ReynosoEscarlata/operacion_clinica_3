import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { initSentry, registerProcessErrorHandlers } from './config/sentry.js';
import { AppError } from './lib/app-error.js';
import { buildDeadLetterRepository } from './lib/dead-letter.repository.js';
import type { DeadLetterHandler, EventHandler } from './lib/event-consumer.js';
import { startEventConsumer } from './lib/event-consumer.js';
import { logger } from './lib/logger.js';
import { startOutboxRelay } from './lib/outbox-relay.js';
import { buildDefaultAppointmentService } from './modules/appointments/appointments.routes.js';
import { buildAppointmentRepository } from './modules/appointments/appointments.repository.js';
import { buildStateMachine } from './modules/appointments/state-machine.js';
import { scheduleNoShowJob } from './queues/jobs/noshow.job.js';
import { closeQueues } from './queues/queues.js';
import { buildExpirationWorker } from './queues/workers/expiration.worker.js';
import { buildNoShowWorker } from './queues/workers/noshow.worker.js';
import { buildReminderWorker } from './queues/workers/reminder.worker.js';

const start = async (): Promise<void> => {
  initSentry();
  registerProcessErrorHandlers();

  const stateMachine = buildStateMachine(prisma, logger);
  const appointmentRepository = buildAppointmentRepository(prisma);

  const app = await buildApp();

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

  const reminderWorker = buildReminderWorker({ appointmentRepository, stateMachine, logger });
  const noShowWorker = buildNoShowWorker({ appointmentRepository, stateMachine, logger });

  await scheduleNoShowJob();

  // Publica AppointmentCreated/AppointmentStatusChanged/PatientUpdated
  // (escritos en su propio Outbox) a Redis Streams para que Notifications
  // los consuma en una fase futura.
  const stopOutboxRelay = startOutboxRelay({ prisma, redis, logger });

  // Consume PaymentSucceeded/PaymentFailed publicados por Payments — cierra
  // el ciclo de confirmación de pago descrito en ADR-002/RFC-001. Usa una
  // conexión Redis propia porque XREADGROUP con BLOCK ocupa la conexión.
  const appointmentService = buildDefaultAppointmentService();
  const consumerRedis = redis.duplicate();

  const handlePaymentSucceeded: EventHandler = async (event) => {
    const { appointmentId, paymentIntentId } = event.payload as {
      appointmentId: string;
      paymentIntentId: string;
    };
    try {
      await appointmentService.confirmPayment(appointmentId, paymentIntentId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_STATE_TRANSITION') {
        logger.info(
          { appointmentId },
          'PaymentSucceeded ignorado: la cita ya no está en CONFIRMED (evento duplicado o fuera de orden)',
        );
        return;
      }
      throw error;
    }
  };

  const handlePaymentFailed: EventHandler = async (event) => {
    const { appointmentId, paymentIntentId, reason } = event.payload as {
      appointmentId: string;
      paymentIntentId: string;
      reason: string | null;
    };
    await appointmentService.recordPaymentFailed(appointmentId, paymentIntentId, reason);
  };

  const deadLetterRepository = buildDeadLetterRepository(prisma);
  const onDeadLetter: DeadLetterHandler = async (event, error, attempts) => {
    await deadLetterRepository.record(
      event.eventId,
      event.type,
      event.payload,
      error instanceof Error ? error.message : String(error),
      attempts,
    );
  };

  const stopEventConsumer = startEventConsumer({
    redis: consumerRedis,
    groupName: 'appointments',
    consumerName: `appointments-${process.pid}`,
    logger,
    handlers: {
      PaymentSucceeded: handlePaymentSucceeded,
      PaymentFailed: handlePaymentFailed,
    },
    onDeadLetter,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Iniciando apagado del servicio');

    stopEventConsumer();
    stopOutboxRelay();
    consumerRedis.disconnect();
    await app.close();
    await expirationWorker.close();
    await reminderWorker.close();
    await noShowWorker.close();
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();

    logger.info({ signal }, 'Servicio apagado correctamente');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, service: 'appointments' }, 'Servicio iniciado');
};

start().catch((error: unknown) => {
  logger.error({ err: error }, 'Error fatal al iniciar el servicio');
  process.exit(1);
});
