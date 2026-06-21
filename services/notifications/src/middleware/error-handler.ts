import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { Sentry } from '../config/sentry.js';
import { AppError } from '../lib/app-error.js';

const isSchemaValidationError = (error: FastifyError | Error): boolean =>
  'code' in error && error.code === 'FST_ERR_VALIDATION';

export const errorHandler = (
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void => {
  const requestId = request.requestId;

  if (error instanceof AppError) {
    if (!error.isOperational) {
      request.log.error({ err: error }, 'Error no operacional');
      Sentry.captureException(error, { tags: { requestId } });
    }

    const statusCode = error.isOperational ? error.statusCode : 500;
    const code = error.isOperational ? error.code : 'INTERNAL_ERROR';
    const message = error.isOperational ? error.message : 'Error interno del servidor';

    reply.status(statusCode).send({ error: { code, message, requestId } });
    return;
  }

  if (isSchemaValidationError(error)) {
    reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: error.message, requestId },
    });
    return;
  }

  request.log.error({ err: error }, 'Error no controlado');
  Sentry.captureException(error, { tags: { requestId } });

  reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor', requestId },
  });
};
