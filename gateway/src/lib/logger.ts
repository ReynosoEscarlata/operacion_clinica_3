import pino from 'pino';

import { env } from '../config/env.js';
import { getRequestId, getTenantId } from './request-context.js';

export type Logger = pino.Logger;

const options: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'gateway' },
  // tenantId solo si truthy -- una request sin JWT o de un rol de
  // plataforma no debe ensuciar Logs Insights con `tenantId: null` en cada
  // línea (Fase 6, ADR-017).
  mixin: () => {
    const requestId = getRequestId();
    const tenantId = getTenantId();
    return {
      ...(requestId ? { requestId } : {}),
      ...(tenantId ? { tenantId } : {}),
    };
  },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
};

export const logger: Logger = pino(options);
