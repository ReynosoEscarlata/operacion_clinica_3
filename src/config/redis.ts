import { Redis as RedisClient } from 'ioredis';

import { env } from './env.js';
import { logger } from '../lib/logger.js';

export const createRedisConnection = (): RedisClient => {
  const client = new RedisClient(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  // Sin este listener, un error de conexión transitorio se convierte en una
  // excepción no capturada (EventEmitter) y tira el proceso completo.
  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'Error de conexión a Redis');
  });

  return client;
};

export const redis = createRedisConnection();
