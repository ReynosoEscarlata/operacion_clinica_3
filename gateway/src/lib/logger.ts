import pino from 'pino';

import { env } from '../config/env.js';

export type Logger = pino.Logger;

const options: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'gateway' },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
};

export const logger: Logger = pino(options);
