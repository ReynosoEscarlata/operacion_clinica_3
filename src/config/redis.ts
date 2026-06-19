import { Redis as RedisClient } from 'ioredis';

import { env } from './env.js';

export const createRedisConnection = (): RedisClient =>
  new RedisClient(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

export const redis = createRedisConnection();
