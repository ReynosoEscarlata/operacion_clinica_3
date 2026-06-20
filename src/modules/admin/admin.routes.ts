import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';

import type { DeadLetterControllerDeps } from './dead-letter.controller.js';
import { buildDeadLetterController } from './dead-letter.controller.js';

export interface AdminRoutesDeps extends DeadLetterControllerDeps {}

export const registerAdminRoutes = (app: FastifyInstance, deps?: AdminRoutesDeps): void => {
  if (!deps) return;

  const controller = buildDeadLetterController(deps);

  // GET /api/admin/dead-letter - Listar jobs fallidos
  app.get(
    '/api/admin/dead-letter',
    {
      schema: {
        description: 'Listar jobs fallidos en dead-letter',
        response: {
          200: Type.Object({
            status: Type.Literal('ok'),
            data: Type.Array(
              Type.Object({
                id: Type.String(),
                queueName: Type.String(),
                jobName: Type.String(),
                data: Type.Unknown(),
                failedReason: Type.String(),
                attemptsMade: Type.Number(),
                timestamp: Type.String(),
              }),
            ),
            count: Type.Number(),
          }),
        },
      },
    },
    (request, reply) => controller.getFailedJobs(request, reply),
  );

  // POST /api/admin/dead-letter/:queueName/:jobId/retry - Reintentar job
  app.post(
    '/api/admin/dead-letter/:queueName/:jobId/retry',
    {
      schema: {
        description: 'Reintentar un job fallido',
        params: Type.Object({
          queueName: Type.String(),
          jobId: Type.String(),
        }),
        response: {
          200: Type.Object({
            status: Type.Literal('ok'),
            message: Type.String(),
          }),
        },
      },
    },
    (request, reply) => {
      const { queueName, jobId } = request.params as { queueName: string; jobId: string };
      return controller.retryJob(
        { ...request, params: { jobId, queueName } } as any,
        reply,
      );
    },
  );

  // DELETE /api/admin/dead-letter/:queueName/:jobId - Remover job
  app.delete(
    '/api/admin/dead-letter/:queueName/:jobId',
    {
      schema: {
        description: 'Remover un job fallido',
        params: Type.Object({
          queueName: Type.String(),
          jobId: Type.String(),
        }),
        response: {
          200: Type.Object({
            status: Type.Literal('ok'),
            message: Type.String(),
          }),
        },
      },
    },
    (request, reply) => {
      const { queueName, jobId } = request.params as { queueName: string; jobId: string };
      return controller.removeJob(
        { ...request, params: { jobId, queueName } } as any,
        reply,
      );
    },
  );
};
