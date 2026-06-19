import { buildApp } from './app.js';
import { env } from './config/env.js';
import { initSentry } from './config/sentry.js';
import { logger } from './lib/logger.js';

const start = async (): Promise<void> => {
  initSentry();

  const app = buildApp();

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, 'Servidor arrancado');
  } catch (error) {
    logger.error({ err: error }, 'Error al arrancar el servidor');
    process.exit(1);
  }
};

void start();
