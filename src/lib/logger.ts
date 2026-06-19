import pino from 'pino';

import { env } from '../config/env.js';

export type Logger = pino.Logger;

const options: pino.LoggerOptions =
  env.NODE_ENV === 'development'
    ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { colorize: true } } }
    : { level: env.LOG_LEVEL };

export const logger: Logger = pino(options);
