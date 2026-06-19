import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { initSentry, registerProcessErrorHandlers } from './config/sentry.js';
import { logger } from './lib/logger.js';
import { buildStateMachine } from './modules/appointments/state-machine.js';
import { closeQueues } from './queues/queues.js';
import { buildExpirationWorker } from './queues/workers/expiration.worker.js';

const start = async (): Promise<void> => {
  initSentry();
  registerProcessErrorHandlers();

  const app = buildApp();

  const stateMachine = buildStateMachine(prisma, logger);
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

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Iniciando apagado del servidor');

    await app.close();
    await expirationWorker.close();
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
