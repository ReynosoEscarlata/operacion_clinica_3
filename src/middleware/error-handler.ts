import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { Sentry } from '../config/sentry.js';
import { AppError } from '../lib/app-error.js';
import { logger } from '../lib/logger.js';

export const errorHandler = (
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void => {
  const requestId = request.requestId;

  if (error instanceof AppError) {
    if (!error.isOperational) {
      logger.error({ err: error, requestId }, 'Error no operacional');
      Sentry.captureException(error, { extra: { requestId } });
    }

    const statusCode = error.isOperational ? error.statusCode : 500;
    const code = error.isOperational ? error.code : 'INTERNAL_ERROR';
    const message = error.isOperational ? error.message : 'Error interno del servidor';

    reply.status(statusCode).send({ error: { code, message, requestId } });
    return;
  }

  logger.error({ err: error, requestId }, 'Error no controlado');
  Sentry.captureException(error, { extra: { requestId } });

  reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor', requestId },
  });
};
