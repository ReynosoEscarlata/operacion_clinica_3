import { buildSnsClient, buildSqsClient, startDlqDrain, startQueueConsumer, type DeadLetterHandler } from '@clinica/messaging';

import { buildApp } from './app.js';
import { buildAwsConfig } from './config/aws.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { initSentry, registerProcessErrorHandlers } from './config/sentry.js';
import { buildDeadLetterRepository } from './lib/dead-letter.repository.js';
import { buildDomainEventHandlers } from './lib/domain-event-handlers.js';
import { logger } from './lib/logger.js';
import { startOutboxRelay } from './lib/outbox-relay.js';
import { buildDefaultAppointmentService } from './modules/appointments/appointments.routes.js';
import { buildAppointmentRepository } from './modules/appointments/appointments.repository.js';
import { buildStateMachine } from './modules/appointments/state-machine.js';
import { APPOINTMENT_EXPIRATION_EVENT_TYPE } from './queues/jobs/expiration.job.js';
import { APPOINTMENT_REMINDER_EVENT_TYPE } from './queues/jobs/reminder.job.js';
import { buildExpirationEventHandler } from './queues/workers/expiration.worker.js';
import { buildReminderEventHandler } from './queues/workers/reminder.worker.js';
import { startNoShowConsumer } from './queues/workers/noshow.worker.js';

const start = async (): Promise<void> => {
  initSentry();
  registerProcessErrorHandlers();

  const stateMachine = buildStateMachine(prisma, logger);
  const appointmentRepository = buildAppointmentRepository(prisma);

  // El módulo admin (dashboard/dead-letter) reusa la misma instancia y el
  // mismo mapa de handlers que el consumer real -- "reintentar" una entrada
  // de dead-letter re-invoca el handler real, no uno aparte.
  const appointmentService = buildDefaultAppointmentService({ repository: appointmentRepository, stateMachine });
  const domainEventHandlers = buildDomainEventHandlers({ appointmentService, logger });

  const app = await buildApp({ admin: { appointmentRepository, domainEventHandlers } });

  const snsClient = buildSnsClient(buildAwsConfig());
  const sqsClient = buildSqsClient(buildAwsConfig());

  // Publica AppointmentCreated/AppointmentStatusChanged/PatientUpdated
  // (escritos en su propio Outbox) a SNS para que Notifications los consuma.
  const stopOutboxRelay = startOutboxRelay({ prisma, snsClient, topicArn: env.DOMAIN_EVENTS_TOPIC_ARN, logger });

  const deadLetterRepository = buildDeadLetterRepository(prisma);
  const onDomainEventDeadLetter: DeadLetterHandler = async (event, error, attempts) => {
    // event.tenantId puede ser null solo si el envelope ni siquiera pudo
    // parsearse (ver bestEffortEvent en @clinica/messaging) -- DeadLetterEntry.
    // tenantId es NOT NULL (Fase 3a), así que ese caso se loguea como error
    // crítico en vez de perder silenciosamente el registro.
    if (!event.tenantId) {
      logger.error(
        { event, error: error instanceof Error ? error.message : String(error) },
        'Evento de dominio sin tenantId a dead-letter -- registro perdido',
      );
      return;
    }

    await deadLetterRepository.record(
      event.tenantId,
      event.eventId,
      event.type,
      event.payload,
      error instanceof Error ? error.message : String(error),
      attempts,
    );
  };

  // Consume PaymentSucceeded/PaymentFailed publicados por Payments -- cierra
  // el ciclo de confirmación de pago descrito en ADR-002/RFC-001. Fase 3b
  // (ADR-014): cola SQS propia suscrita al topic SNS compartido, reemplaza
  // el consumer group que tenía sobre el stream de Redis.
  const stopDomainEventsConsumer = startQueueConsumer({
    sqsClient,
    queueUrl: env.APPOINTMENTS_DOMAIN_EVENTS_QUEUE_URL,
    maxReceiveCount: env.APPOINTMENTS_DOMAIN_EVENTS_MAX_RECEIVE_COUNT,
    logger,
    handlers: domainEventHandlers,
    onDeadLetter: onDomainEventDeadLetter,
  });

  const stopDomainEventsDlqDrain = startDlqDrain({
    sqsClient,
    dlqUrl: env.APPOINTMENTS_DOMAIN_EVENTS_DLQ_URL,
    maxReceiveCount: env.APPOINTMENTS_DOMAIN_EVENTS_MAX_RECEIVE_COUNT,
    logger,
    onDrain: onDomainEventDeadLetter,
  });

  // Expiration (1 intento, sin dead-letter) y reminders (3 intentos, con
  // dead-letter) -- reemplazan los Workers de BullMQ. El trigger recurrente
  // de no-show (rate(15 minutes)) es infra estática (CfnSchedule, ver
  // PLAN.md CDK), este servicio solo consume su cola.
  const stopExpirationConsumer = startQueueConsumer({
    sqsClient,
    queueUrl: env.APPOINTMENT_EXPIRATION_QUEUE_URL,
    maxReceiveCount: env.APPOINTMENT_EXPIRATION_MAX_RECEIVE_COUNT,
    logger,
    handlers: {
      [APPOINTMENT_EXPIRATION_EVENT_TYPE]: buildExpirationEventHandler({
        findStatusById: (id) => appointmentRepository.findStatusById(id),
        stateMachine,
        logger,
      }),
    },
  });

  const onReminderDeadLetter: DeadLetterHandler = async (event, error, attempts) => {
    if (!event.tenantId) {
      logger.error(
        { event, error: error instanceof Error ? error.message : String(error) },
        'Job de recordatorio sin tenantId a dead-letter -- registro perdido',
      );
      return;
    }
    await deadLetterRepository.record(
      event.tenantId,
      event.eventId,
      event.type,
      event.payload,
      error instanceof Error ? error.message : String(error),
      attempts,
    );
  };

  const stopRemindersConsumer = startQueueConsumer({
    sqsClient,
    queueUrl: env.APPOINTMENT_REMINDERS_QUEUE_URL,
    maxReceiveCount: env.APPOINTMENT_REMINDERS_MAX_RECEIVE_COUNT,
    logger,
    handlers: {
      [APPOINTMENT_REMINDER_EVENT_TYPE]: buildReminderEventHandler({ appointmentRepository, stateMachine, logger }),
    },
    onDeadLetter: onReminderDeadLetter,
  });

  const stopRemindersDlqDrain = startDlqDrain({
    sqsClient,
    dlqUrl: env.APPOINTMENT_REMINDERS_DLQ_URL,
    maxReceiveCount: env.APPOINTMENT_REMINDERS_MAX_RECEIVE_COUNT,
    logger,
    onDrain: onReminderDeadLetter,
  });

  const stopNoShowConsumer = startNoShowConsumer({
    sqsClient,
    queueUrl: env.APPOINTMENT_NOSHOW_QUEUE_URL,
    appointmentRepository,
    stateMachine,
    logger,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Iniciando apagado del servicio');

    stopDomainEventsConsumer();
    stopDomainEventsDlqDrain();
    stopExpirationConsumer();
    stopRemindersConsumer();
    stopRemindersDlqDrain();
    stopNoShowConsumer();
    stopOutboxRelay();
    await app.close();
    await prisma.$disconnect();

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
