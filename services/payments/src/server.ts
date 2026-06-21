import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { initSentry, registerProcessErrorHandlers } from './config/sentry.js';
import { logger } from './lib/logger.js';
import { startOutboxRelay } from './lib/outbox-relay.js';

const start = async (): Promise<void> => {
  initSentry();
  registerProcessErrorHandlers();

  const app = await buildApp();
  const stopOutboxRelay = startOutboxRelay({ prisma, redis, logger });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Iniciando apagado del servicio');
    stopOutboxRelay();
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    logger.info({ signal }, 'Servicio apagado correctamente');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, service: 'payments' }, 'Servicio iniciado');
};

start().catch((error: unknown) => {
  logger.error({ err: error }, 'Error fatal al iniciar el servicio');
  process.exit(1);
});
