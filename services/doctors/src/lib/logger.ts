import pino from 'pino';

import { env } from '../config/env.js';
import { getRequestId } from './request-context.js';

export type Logger = pino.Logger;

const options: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'doctors' },
  mixin: () => {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
};

export const logger: Logger = pino(options);
