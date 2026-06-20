import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import {
  emailNotificationsQueue,
  appointmentRemindersQueue,
  appointmentExpirationQueue,
} from '../../src/queues/queues.js';
import type { EmailJobData } from '../../src/queues/jobs/email.job.js';

describe('Queue System - Integration', () => {
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;

  beforeAll(async () => {
    const doctor = await prisma.doctor.create({
      data: {
        name: 'Dr. Queue Test',
        email: `queue-doctor-${randomUUID()}@example.com`,
        specialty: 'Test',
        consultationPriceCents: 50000,
      },
    });
    doctorId = doctor.id;

    const patient = await prisma.patient.create({
      data: {
        email: `queue-patient-${randomUUID()}@example.com`,
        name: 'Paciente Queue Test',
        phone: '+54 9 11 1234-5678',
      },
    });
    patientId = patient.id;

    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        durationMinutes: 30,
        amountCents: 50000,
        status: 'PAID',
      },
    });
    appointmentId = appointment.id;
  });

  afterAll(async () => {
    await appointmentExpirationQueue.clean(0, 10000);
    await emailNotificationsQueue.clean(0, 10000);
    await appointmentRemindersQueue.clean(0, 10000);

    await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('email job se encola correctamente', async () => {
    const jobData: EmailJobData = {
      type: 'confirmation',
      appointmentId,
    };

    const job = await emailNotificationsQueue.add('send-email', jobData);
    expect(job).toBeDefined();
    expect(job.data.type).toBe('confirmation');
    expect(job.data.appointmentId).toBe(appointmentId);
  });

  it('email job reintentas con backoff exponencial', async () => {
    // Verificar la configuración del backoff
    const jobOptions = emailNotificationsQueue.defaultJobOptions;
    expect(jobOptions?.attempts).toBe(3);
    expect(jobOptions?.backoff).toEqual({ type: 'exponential', delay: 5_000 });
  });

  it('expiration job tiene attempts=1 (sin retry)', () => {
    const jobOptions = appointmentExpirationQueue.defaultJobOptions;
    expect(jobOptions?.attempts).toBe(1);
  });

  it('reminder job tiene backoff de 10s', () => {
    const jobOptions = appointmentRemindersQueue.defaultJobOptions;
    expect(jobOptions?.attempts).toBe(3);
    expect(jobOptions?.backoff).toEqual({ type: 'exponential', delay: 10_000 });
  });

  it('email job propagates requestId', async () => {
    const requestId = randomUUID();
    const jobData: EmailJobData = {
      type: 'confirmation',
      appointmentId,
      requestId,
    };

    const job = await emailNotificationsQueue.add('send-email', jobData);
    expect(job.data.requestId).toBe(requestId);
  });
});
