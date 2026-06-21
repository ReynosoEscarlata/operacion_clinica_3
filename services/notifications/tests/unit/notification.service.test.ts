import type { AppointmentSnapshot, PatientSnapshot } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationChannel } from '../../src/clients/notification-channel.js';
import { logger } from '../../src/lib/logger.js';
import { buildNotificationService } from '../../src/modules/notifications/notification.service.js';
import type { NotificationLogRepository } from '../../src/modules/notifications/notification-log.repository.js';
import type { SnapshotsRepository } from '../../src/modules/notifications/snapshots.repository.js';

const buildAppointment = (overrides: Partial<AppointmentSnapshot> = {}): AppointmentSnapshot => ({
  id: 'apt-1',
  patientId: 'patient-1',
  doctorId: 'doctor-1',
  dateTime: new Date(),
  amountCents: 50_000,
  status: 'CONFIRMED',
  updatedAt: new Date(),
  ...overrides,
});

const buildPatient = (overrides: Partial<PatientSnapshot> = {}): PatientSnapshot => ({
  id: 'patient-1',
  email: 'patient@example.com',
  name: 'Paciente Test',
  updatedAt: new Date(),
  ...overrides,
});

describe('NotificationService', () => {
  it('AppointmentCreated: crea el snapshot de la cita', async () => {
    const snapshots: SnapshotsRepository = {
      upsertAppointment: vi.fn().mockResolvedValue(buildAppointment()),
      updateAppointmentStatus: vi.fn(),
      getAppointment: vi.fn(),
      upsertPatient: vi.fn(),
      getPatient: vi.fn(),
      upsertDoctor: vi.fn(),
      getDoctor: vi.fn(),
    };
    const channel: NotificationChannel = { name: 'email', send: vi.fn() };
    const logs: NotificationLogRepository = { record: vi.fn(), wasAlreadySent: vi.fn().mockResolvedValue(false) };
    const service = buildNotificationService({ snapshots, channel, logs, logger });

    await service.handleAppointmentCreated({
      appointmentId: 'apt-1',
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      dateTime: new Date().toISOString(),
    });

    expect(snapshots.upsertAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'apt-1', patientId: 'patient-1', doctorId: 'doctor-1' }),
    );
  });

  it('AppointmentStatusChanged a PAID: envía el email de confirmación', async () => {
    const snapshots: SnapshotsRepository = {
      upsertAppointment: vi.fn(),
      updateAppointmentStatus: vi.fn().mockResolvedValue(buildAppointment({ status: 'PAID' })),
      getAppointment: vi.fn(),
      upsertPatient: vi.fn(),
      getPatient: vi.fn().mockResolvedValue(buildPatient()),
      upsertDoctor: vi.fn(),
      getDoctor: vi.fn(),
    };
    const channel: NotificationChannel = { name: 'email', send: vi.fn().mockResolvedValue(undefined) };
    const logs: NotificationLogRepository = { record: vi.fn(), wasAlreadySent: vi.fn().mockResolvedValue(false) };
    const service = buildNotificationService({ snapshots, channel, logs, logger });

    await service.handleAppointmentStatusChanged({
      appointmentId: 'apt-1',
      from: 'CONFIRMED',
      to: 'PAID',
      trigger: 'webhook',
    });

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'patient@example.com', subject: expect.stringContaining('confirmada') }),
    );
    expect(logs.record).toHaveBeenCalledWith('apt-1', 'email', 'confirmation', 'SENT');
  });

  it('AppointmentStatusChanged a CANCELLED: usa el refundAmountCents del evento', async () => {
    const snapshots: SnapshotsRepository = {
      upsertAppointment: vi.fn(),
      updateAppointmentStatus: vi.fn().mockResolvedValue(buildAppointment({ status: 'CANCELLED' })),
      getAppointment: vi.fn(),
      upsertPatient: vi.fn(),
      getPatient: vi.fn().mockResolvedValue(buildPatient()),
      upsertDoctor: vi.fn(),
      getDoctor: vi.fn(),
    };
    const channel: NotificationChannel = { name: 'email', send: vi.fn().mockResolvedValue(undefined) };
    const logs: NotificationLogRepository = { record: vi.fn(), wasAlreadySent: vi.fn().mockResolvedValue(false) };
    const service = buildNotificationService({ snapshots, channel, logs, logger });

    await service.handleAppointmentStatusChanged({
      appointmentId: 'apt-1',
      from: 'PAID',
      to: 'CANCELLED',
      trigger: 'patient',
      refundAmountCents: 25_000,
    });

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('250.00') }),
    );
    expect(logs.record).toHaveBeenCalledWith('apt-1', 'email', 'cancellation', 'SENT');
  });

  it('reintenta (lanza) si el snapshot de la cita no existe todavía', async () => {
    const snapshots: SnapshotsRepository = {
      upsertAppointment: vi.fn(),
      updateAppointmentStatus: vi.fn().mockResolvedValue(null),
      getAppointment: vi.fn(),
      upsertPatient: vi.fn(),
      getPatient: vi.fn(),
      upsertDoctor: vi.fn(),
      getDoctor: vi.fn(),
    };
    const channel: NotificationChannel = { name: 'email', send: vi.fn() };
    const logs: NotificationLogRepository = { record: vi.fn(), wasAlreadySent: vi.fn().mockResolvedValue(false) };
    const service = buildNotificationService({ snapshots, channel, logs, logger });

    await expect(
      service.handleAppointmentStatusChanged({
        appointmentId: 'apt-1',
        from: 'CONFIRMED',
        to: 'PAID',
        trigger: 'webhook',
      }),
    ).rejects.toThrow();
  });

  it('registra el fallo y relanza si el canal de envío falla', async () => {
    const snapshots: SnapshotsRepository = {
      upsertAppointment: vi.fn(),
      updateAppointmentStatus: vi.fn().mockResolvedValue(buildAppointment({ status: 'PAID' })),
      getAppointment: vi.fn(),
      upsertPatient: vi.fn(),
      getPatient: vi.fn().mockResolvedValue(buildPatient()),
      upsertDoctor: vi.fn(),
      getDoctor: vi.fn(),
    };
    const channel: NotificationChannel = {
      name: 'email',
      send: vi.fn().mockRejectedValue(new Error('resend down')),
    };
    const logs: NotificationLogRepository = { record: vi.fn(), wasAlreadySent: vi.fn().mockResolvedValue(false) };
    const service = buildNotificationService({ snapshots, channel, logs, logger });

    await expect(
      service.handleAppointmentStatusChanged({
        appointmentId: 'apt-1',
        from: 'CONFIRMED',
        to: 'PAID',
        trigger: 'webhook',
      }),
    ).rejects.toThrow('resend down');

    expect(logs.record).toHaveBeenCalledWith('apt-1', 'email', 'confirmation', 'FAILED', expect.any(String));
  });

  it('idempotencia: un AppointmentStatusChanged duplicado no envía un segundo email', async () => {
    const snapshots: SnapshotsRepository = {
      upsertAppointment: vi.fn(),
      updateAppointmentStatus: vi.fn().mockResolvedValue(buildAppointment({ status: 'PAID' })),
      getAppointment: vi.fn(),
      upsertPatient: vi.fn(),
      getPatient: vi.fn().mockResolvedValue(buildPatient()),
      upsertDoctor: vi.fn(),
      getDoctor: vi.fn(),
    };
    const channel: NotificationChannel = { name: 'email', send: vi.fn().mockResolvedValue(undefined) };
    // Simula que ya existe un NotificationLog SENT para (apt-1, confirmation)
    // — exactamente lo que pasaría si el mismo evento se entrega dos veces.
    const logs: NotificationLogRepository = {
      record: vi.fn(),
      wasAlreadySent: vi.fn().mockResolvedValue(true),
    };
    const service = buildNotificationService({ snapshots, channel, logs, logger });

    await service.handleAppointmentStatusChanged({
      appointmentId: 'apt-1',
      from: 'CONFIRMED',
      to: 'PAID',
      trigger: 'webhook',
    });

    expect(channel.send).not.toHaveBeenCalled();
    expect(logs.record).not.toHaveBeenCalled();
  });

  it('PatientUpdated: actualiza el snapshot del paciente', async () => {
    const snapshots: SnapshotsRepository = {
      upsertAppointment: vi.fn(),
      updateAppointmentStatus: vi.fn(),
      getAppointment: vi.fn(),
      upsertPatient: vi.fn().mockResolvedValue(buildPatient()),
      getPatient: vi.fn(),
      upsertDoctor: vi.fn(),
      getDoctor: vi.fn(),
    };
    const channel: NotificationChannel = { name: 'email', send: vi.fn() };
    const logs: NotificationLogRepository = { record: vi.fn(), wasAlreadySent: vi.fn().mockResolvedValue(false) };
    const service = buildNotificationService({ snapshots, channel, logs, logger });

    await service.handlePatientUpdated({ patientId: 'patient-1', email: 'a@a.com', name: 'A' });

    expect(snapshots.upsertPatient).toHaveBeenCalledWith({ id: 'patient-1', email: 'a@a.com', name: 'A' });
  });
});
