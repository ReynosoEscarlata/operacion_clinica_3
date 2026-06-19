import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../config/env.js';
import { AppError } from '../lib/app-error.js';

export const requireAdminAuth = async (
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> => {
  const apiKey = request.headers['x-admin-api-key'];

  if (apiKey !== env.ADMIN_API_KEY) {
    throw new AppError(401, 'UNAUTHORIZED', 'Credenciales de admin inválidas');
  }
};
