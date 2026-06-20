import type { FastifyRequest, FastifyReply } from 'fastify';

import type { DeadLetterService } from './dead-letter.service.js';

export interface DeadLetterControllerDeps {
  deadLetterService: DeadLetterService;
}

export const buildDeadLetterController = (deps: DeadLetterControllerDeps) => ({
  async getFailedJobs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const jobs = await deps.deadLetterService.getFailedJobs();

    reply.send({
      status: 'ok',
      data: jobs,
      count: jobs.length,
    });
  },

  async retryJob(
    request: FastifyRequest<{ Params: { jobId: string; queueName: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { jobId, queueName } = request.params;

    await deps.deadLetterService.retryJob(jobId, queueName);

    reply.send({
      status: 'ok',
      message: 'Job reiniciado',
    });
  },

  async removeJob(
    request: FastifyRequest<{ Params: { jobId: string; queueName: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { jobId, queueName } = request.params;

    await deps.deadLetterService.removeJob(jobId, queueName);

    reply.send({
      status: 'ok',
      message: 'Job removido',
    });
  },
});
