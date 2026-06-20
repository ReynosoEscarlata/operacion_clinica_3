import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';
import type { EmailJobData } from '../../src/queues/jobs/email.job.js';
import { processEmailJob } from '../../src/queues/workers/email.worker.js';
import type { ReminderJobData } from '../../src/queues/jobs/reminder.job.js';
import { processReminderJob } from '../../src/queues/workers/reminder.worker.js';
import { processNoShowJob } from '../../src/queues/workers/noshow.worker.js';
import { buildEmailService } from '../../src/modules/notifications/email.service.js';
import { logger } from '../../src/lib/logger.js';
import { buildStateMachine } from '../../src/modules/appointments/state-machine.js';
import { buildAppointmentRepository } from '../../src/modules/appointments/appointments.repository.js';

describe('Email Worker', () => {
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;
  let emailService: ReturnType<typeof buildEmailService>;

  beforeAll(async () => {
    const doctor = await prisma.doctor.create({
      data: {
        name: 'Dr. Email Test',
        email: `email-doctor-${randomUUID()}@example.com`,
        specialty: 'Test',
        consultationPriceCents: 50000,
      },
    });
    doctorId = doctor.id;

    const patient = await prisma.patient.create({
      data: {
        email: `email-patient-${randomUUID()}@example.com`,
        name: 'Paciente Email Test',
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

    emailService = buildEmailService(logger);
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('procesa email de confirmación sin error', async () => {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });

    if (!appointment || !patient) {
      throw new Error('Appointment o patient no encontrados');
    }

    const sendSpy = vi.spyOn(emailService, 'sendConfirmationEmail').mockResolvedValue(undefined);

    const jobData: EmailJobData = {
      type: 'confirmation',
      appointmentId,
    };

    const appointmentRepository = buildAppointmentRepository(prisma);

    await processEmailJob(jobData, {
      appointmentRepository,
      patientRepository: {
        findById: async (id) => {
          const p = await prisma.patient.findUnique({ where: { id } });
          return p ? { id: p.id, email: p.email, name: p.name } : null;
        },
      },
      emailService,
      logger,
    });

    expect(sendSpy).toHaveBeenCalledWith(appointment, patient);

    // Verificar que se registró el evento
    const event = await prisma.appointmentEvent.findFirst({
      where: { appointmentId, type: 'EMAIL_SENT' },
      orderBy: { createdAt: 'desc' },
    });

    expect(event).toBeDefined();
    expect(event?.payload).toHaveProperty('emailType', 'confirmation');
  });

  it('falla con error cuando la cita no existe', async () => {
    const jobData: EmailJobData = {
      type: 'confirmation',
      appointmentId: randomUUID(),
    };

    const appointmentRepository = buildAppointmentRepository(prisma);

    await expect(
      processEmailJob(jobData, {
        appointmentRepository,
        patientRepository: {
          findById: async () => null,
        },
        emailService,
        logger,
      }),
    ).rejects.toThrow('Cita no encontrada');
  });
});

describe('Reminder Worker', () => {
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;
  const appointmentDateTime = new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000);

  beforeAll(async () => {
    const doctor = await prisma.doctor.create({
      data: {
        name: 'Dr. Reminder Test',
        email: `reminder-doctor-${randomUUID()}@example.com`,
        specialty: 'Test',
        consultationPriceCents: 50000,
      },
    });
    doctorId = doctor.id;

    const patient = await prisma.patient.create({
      data: {
        email: `reminder-patient-${randomUUID()}@example.com`,
        name: 'Paciente Reminder Test',
        phone: '+54 9 11 1234-5678',
      },
    });
    patientId = patient.id;

    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: appointmentDateTime,
        durationMinutes: 30,
        amountCents: 50000,
        status: 'PAID',
      },
    });
    appointmentId = appointment.id;
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('transiciona cita PAID a REMINDED y envía email', async () => {
    const emailService = buildEmailService(logger);
    const appointmentRepository = buildAppointmentRepository(prisma);
    const stateMachine = buildStateMachine(prisma, logger);
    const sendSpy = vi.spyOn(emailService, 'sendReminderEmail').mockResolvedValue(undefined);

    const jobData: ReminderJobData = {
      appointmentId,
    };

    await processReminderJob(jobData, {
      appointmentRepository,
      patientRepository: {
        findById: async (id) => {
          const p = await prisma.patient.findUnique({ where: { id } });
          return p ? { id: p.id, email: p.email, name: p.name } : null;
        },
      },
      emailService,
      stateMachine,
      logger,
    });

    expect(sendSpy).toHaveBeenCalled();

    // Verificar que la cita transicionó a REMINDED
    const updated = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(updated?.status).toBe('REMINDED');
    expect(updated?.remindedAt).toBeDefined();
  });

  it('es idempotente: si la cita ya no es PAID, ignora el job', async () => {
    const emailService = buildEmailService(logger);
    const appointmentRepository = buildAppointmentRepository(prisma);
    const stateMachine = buildStateMachine(prisma, logger);
    const sendSpy = vi.spyOn(emailService, 'sendReminderEmail');

    // Primero, cambiar la cita a COMPLETED manualmente
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const jobData: ReminderJobData = {
      appointmentId,
    };

    await processReminderJob(jobData, {
      appointmentRepository,
      patientRepository: {
        findById: async (id) => {
          const p = await prisma.patient.findUnique({ where: { id } });
          return p ? { id: p.id, email: p.email, name: p.name } : null;
        },
      },
      emailService,
      stateMachine,
      logger,
    });

    // El email no debe haber sido enviado
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('NoShow Worker', () => {
  let doctorId: string;
  let patientId: string;
  let appointmentId1: string;
  let appointmentId2: string;

  beforeAll(async () => {
    const doctor = await prisma.doctor.create({
      data: {
        name: 'Dr. NoShow Test',
        email: `noshow-doctor-${randomUUID()}@example.com`,
        specialty: 'Test',
        consultationPriceCents: 50000,
      },
    });
    doctorId = doctor.id;

    const patient = await prisma.patient.create({
      data: {
        email: `noshow-patient-${randomUUID()}@example.com`,
        name: 'Paciente NoShow Test',
        phone: '+54 9 11 1234-5678',
      },
    });
    patientId = patient.id;

    // Cita 1: REMINDED hace más de 1 hora (debe ser marcada como NO_SHOW)
    const oneHourAgo = new Date(Date.now() - 61 * 60 * 1000);
    const apt1 = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: oneHourAgo,
        durationMinutes: 30,
        amountCents: 50000,
        status: 'REMINDED',
        remindedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // recordada hace 25 horas
      },
    });
    appointmentId1 = apt1.id;

    // Cita 2: REMINDED pero hace menos de 1 hora (no debe ser marcada)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const apt2 = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: thirtyMinutesAgo,
        durationMinutes: 30,
        amountCents: 50000,
        status: 'REMINDED',
        remindedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      },
    });
    appointmentId2 = apt2.id;
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { id: { in: [appointmentId1, appointmentId2] } } });
    await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('marca citas REMINDED > 1h como NO_SHOW', async () => {
    const appointmentRepository = buildAppointmentRepository(prisma);
    const stateMachine = buildStateMachine(prisma, logger);

    await processNoShowJob(
      { executedAt: new Date().toISOString() },
      {
        appointmentRepository,
        stateMachine,
        logger,
      },
    );

    const apt1 = await prisma.appointment.findUnique({ where: { id: appointmentId1 } });
    const apt2 = await prisma.appointment.findUnique({ where: { id: appointmentId2 } });

    expect(apt1?.status).toBe('NO_SHOW');
    expect(apt1?.noShowAt).toBeDefined();

    // apt2 no debe cambiar
    expect(apt2?.status).toBe('REMINDED');
    expect(apt2?.noShowAt).toBeNull();
  });
});
