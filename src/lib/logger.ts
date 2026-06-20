import pino from 'pino';

import { env } from '../config/env.js';
import { getRequestId } from './request-context.js';

export type Logger = pino.Logger;

// El mixin inyecta requestId en cada línea de log a partir del contexto de
// AsyncLocalStorage (ver request-context.ts), incluso en services/repositories
// que usan el logger global en vez de un request.log con child binding.
const options: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  mixin: () => {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
};

export const logger: Logger = pino(options);
