import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

const start = async (): Promise<void> => {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'Gateway iniciado');
};

start().catch((error: unknown) => {
  logger.error({ err: error }, 'Error fatal al iniciar el gateway');
  process.exit(1);
});
