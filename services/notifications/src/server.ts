import { buildApp } from './app.js';
import { buildEmailChannel } from './clients/email-channel.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { initSentry, registerProcessErrorHandlers } from './config/sentry.js';
import type { DeadLetterHandler } from './lib/event-consumer.js';
import { startEventConsumer } from './lib/event-consumer.js';
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

  // Consume del mismo stream compartido que Appointments, pero con su
  // propio consumer group: Redis Streams permite que varios servicios lean
  // independientemente los mismos eventos — cada uno con su propio offset
  // y reintentos.
  const consumerRedis = redis.duplicate();
  const stopEventConsumer = startEventConsumer({
    redis: consumerRedis,
    groupName: 'notifications',
    consumerName: `notifications-${process.pid}`,
    logger,
    handlers: buildEventHandlers(notificationService),
    onDeadLetter,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Iniciando apagado del servicio');
    stopEventConsumer();
    consumerRedis.disconnect();
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
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
