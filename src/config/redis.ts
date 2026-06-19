import { Redis as RedisClient } from 'ioredis';

import { env } from './env.js';
import { logger } from '../lib/logger.js';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
}

// BullMQ trae su propia copia interna de ioredis: pasarle una instancia
// construida con NUESTRO ioredis produce un choque de tipos (dos paquetes
// distintos con el mismo nombre). Por eso BullMQ recibe opciones planas y
// crea su propia instancia internamente, en vez de reusar `redis`.
export const getRedisConnectionOptions = (): RedisConnectionOptions => {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
  };
};

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
