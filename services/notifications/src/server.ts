import { buildSqsClient, startDlqDrain, startQueueConsumer, type DeadLetterHandler } from '@clinica/messaging';

import { buildApp } from './app.js';
import { buildEmailChannel } from './clients/email-channel.js';
import { buildAwsConfig } from './config/aws.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { initSentry, registerProcessErrorHandlers } from './config/sentry.js';
import { buildEventHandlers } from './lib/event-handlers.js';
import { logger } from './lib/logger.js';
import { buildDeadLetterRepository } from './modules/notifications/dead-letter.repository.js';
import { buildNotificationLogRepository } from './modules/notifications/notification-log.repository.js';
import { buildNotificationService } from './modules/notifications/notification.service.js';
import { buildSnapshotsRepository } from './modules/notifications/snapshots.repository.js';

const start = async (): Promise<void> => {
  initSentry();
  registerProcessErrorHandlers();

  const notificationService = buildNotificationService({
    snapshots: buildSnapshotsRepository(prisma),
    channel: buildEmailChannel(logger),
    logs: buildNotificationLogRepository(prisma),
    logger,
  });

  // El módulo admin (dashboard/dead-letter) reusa la misma instancia para
  // que "reintentar" una entrada ejecute el handler real, no uno aparte.
  const app = await buildApp({ notifications: { notificationService } });

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

  // Fase 3b (ADR-014): consume su propia cola SQS suscrita al topic SNS
  // compartido (`domain-events`) -- reemplaza el consumer group propio que
  // tenía sobre el stream de Redis. El drenado de la DLQ física es una red
  // de seguridad secundaria (ver packages/messaging/src/dlq-drain.ts): el
  // camino esperado para "agotó reintentos" ya pasa por onDeadLetter dentro
  // del consumer principal, con el error real en mano.
  const sqsClient = buildSqsClient(buildAwsConfig());

  const stopEventConsumer = startQueueConsumer({
    sqsClient,
    queueUrl: env.NOTIFICATIONS_DOMAIN_EVENTS_QUEUE_URL,
    maxReceiveCount: env.NOTIFICATIONS_DOMAIN_EVENTS_MAX_RECEIVE_COUNT,
    logger,
    handlers: buildEventHandlers(notificationService),
    onDeadLetter,
  });

  const stopDlqDrain = startDlqDrain({
    sqsClient,
    dlqUrl: env.NOTIFICATIONS_DOMAIN_EVENTS_DLQ_URL,
    maxReceiveCount: env.NOTIFICATIONS_DOMAIN_EVENTS_MAX_RECEIVE_COUNT,
    logger,
    onDrain: onDeadLetter,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Iniciando apagado del servicio');
    stopEventConsumer();
    stopDlqDrain();
    await app.close();
    await prisma.$disconnect();
    logger.info({ signal }, 'Servicio apagado correctamente');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, service: 'notifications' }, 'Servicio iniciado');
};

start().catch((error: unknown) => {
  logger.error({ err: error }, 'Error fatal al iniciar el servicio');
  process.exit(1);
});
