import pino from 'pino';

import { env } from '../config/env.js';
import { getRequestId } from './request-context.js';
import { getTenantId } from './tenant-context.js';

export type Logger = pino.Logger;

const options: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'doctors' },
  // tenantId solo si truthy -- una ruta pública o sin tenant ambiental no
  // debe ensuciar Logs Insights con `tenantId: null` en cada línea (Fase 6,
  // ADR-017). Funciona gratis también en workers/consumers vía
  // runWithTenant, que usa el mismo AsyncLocalStorage.
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

// TODO Fase 5: redact -- agregar `redact` con los campos de PII candidatos
// (docs/backlog-deuda.md ítem 13). Esta fase (6) solo fija reglas de
// emisión (nunca URL cruda/query string/body, ver packages/observability),
// no implementa el redactor.
export const logger: Logger = pino(options);
