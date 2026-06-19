import * as Sentry from '@sentry/node';

import { env } from './env.js';
import { logger } from '../lib/logger.js';

export const initSentry = (): void => {
  if (!env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
  });
};

export const addStripeBreadcrumb = (
  message: string,
  data: Record<string, unknown> = {},
): void => {
  Sentry.addBreadcrumb({ category: 'stripe', message, data, level: 'info' });
};

export const addQueueBreadcrumb = (
  message: string,
  data: Record<string, unknown> = {},
): void => {
  Sentry.addBreadcrumb({ category: 'bullmq', message, data, level: 'info' });
};

// uncaughtException deja el proceso en estado indefinido: se loguea, se reporta
// y se termina el proceso. unhandledRejection no se considera tan grave (suele
// venir de una promesa puntual no esperada), así que solo se reporta sin matar
// el servidor.
export const registerProcessErrorHandlers = (): void => {
  process.on('uncaughtException', (error: Error) => {
    logger.error({ err: error }, 'Excepción no capturada');
    Sentry.captureException(error, { tags: { handler: 'uncaughtException' } });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({ err: reason }, 'Promesa rechazada sin manejar');
    Sentry.captureException(reason, { tags: { handler: 'unhandledRejection' } });
  });
};

export { Sentry };
