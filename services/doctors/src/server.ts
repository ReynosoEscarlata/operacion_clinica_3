import { buildSnsClient } from '@clinica/messaging';

import { buildApp } from './app.js';
import { buildAwsConfig } from './config/aws.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { initSentry, registerProcessErrorHandlers } from './config/sentry.js';
import { logger } from './lib/logger.js';
import { startOutboxRelay } from './lib/outbox-relay.js';

const start = async (): Promise<void> => {
  initSentry();
  registerProcessErrorHandlers();

  const app = await buildApp();

  const snsClient = buildSnsClient(buildAwsConfig());
  const stopOutboxRelay = startOutboxRelay({ prisma, snsClient, topicArn: env.DOMAIN_EVENTS_TOPIC_ARN, logger });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Iniciando apagado del servicio');
    stopOutboxRelay();
    await app.close();
    await prisma.$disconnect();
    logger.info({ signal }, 'Servicio apagado correctamente');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, service: 'doctors' }, 'Servicio iniciado');
};

start().catch((error: unknown) => {
  logger.error({ err: error }, 'Error fatal al iniciar el servicio');
  process.exit(1);
});
