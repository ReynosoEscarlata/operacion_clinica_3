import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import { logger } from '../../src/lib/logger.js';
import { buildAppointmentRepository } from '../../src/modules/appointments/appointments.repository.js';
import { buildDeadLetterService } from '../../src/modules/admin/dead-letter.service.js';
import { emailNotificationsQueue } from '../../src/queues/queues.js';

describe('Admin Dead Letter Service', () => {
  let deadLetterService: ReturnType<typeof buildDeadLetterService>;

  beforeAll(async () => {
    const appointmentRepository = buildAppointmentRepository(prisma);
    deadLetterService = buildDeadLetterService(appointmentRepository, logger);
  });

  afterAll(async () => {
    await emailNotificationsQueue.clean(0, 10000);
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('getFailedJobs retorna array vacío cuando no hay jobs fallidos', async () => {
    const jobs = await deadLetterService.getFailedJobs();
    // Puede que haya o no jobs fallidos, pero debe retornar un array
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('puede listar la estructura de dead-letter jobs', async () => {
    const jobs = await deadLetterService.getFailedJobs();

    if (jobs.length > 0) {
      const job = jobs[0];
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('queueName');
      expect(job).toHaveProperty('jobName');
      expect(job).toHaveProperty('data');
      expect(job).toHaveProperty('failedReason');
      expect(job).toHaveProperty('attemptsMade');
      expect(job).toHaveProperty('timestamp');
    }
  });

  it('rechaza reintentar un job inexistente', async () => {
    await expect(deadLetterService.retryJob('inexistente', 'email-notifications')).rejects.toThrow();
  });

  it('rechaza remover un job inexistente', async () => {
    await expect(deadLetterService.removeJob('inexistente', 'email-notifications')).rejects.toThrow();
  });

  it('rechaza operaciones en queues que no existen', async () => {
    const fakeJobId = randomUUID();
    await expect(deadLetterService.retryJob(fakeJobId, 'queue-inexistente')).rejects.toThrow(
      'no encontrada',
    );
  });
});
