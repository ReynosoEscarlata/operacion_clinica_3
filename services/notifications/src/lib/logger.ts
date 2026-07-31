import { COMMON_REDACT_PATHS, REDACT_CENSOR } from '@clinica/audit-log';
import pino from 'pino';

import { env } from '../config/env.js';
import { getRequestId } from './request-context.js';
import { getTenantId } from './tenant-context.js';

export type Logger = pino.Logger;

// Exportado además de `logger` para que el test de fuga de PII
// (tests/unit/pii-log-redaction.test.ts) pueda construir un pino propio
// con la MISMA config de redact contra un destino controlado, en vez de
// interceptar stdout del logger real.
export const options: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'notifications' },
  // tenantId solo si truthy -- una ruta pública o sin tenant ambiental no
  // debe ensuciar Logs Insights con `tenantId: null` en cada línea (Fase 6,
  // ADR-017). Funciona gratis también en el consumer de eventos vía
  // runWithTenant, que usa el mismo AsyncLocalStorage.
  mixin: () => {
    const requestId = getRequestId();
    const tenantId = getTenantId();
    return {
      ...(requestId ? { requestId } : {}),
      ...(tenantId ? { tenantId } : {}),
    };
  },
  // Fase 5 (ADR-013): defensa en profundidad -- censura cualquier campo de
  // PII/credenciales en cualquier profundidad del objeto logueado, además
  // del fix puntual ya aplicado en los call sites conocidos (ver
  // fix(notifications,appointments): eliminar PII cruda de logs).
  redact: { paths: COMMON_REDACT_PATHS, censor: REDACT_CENSOR },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
};

export const logger: Logger = pino(options);
