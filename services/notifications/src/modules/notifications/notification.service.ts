import type { AppointmentSnapshot } from '@prisma/client';

import type { NotificationChannel } from '../../clients/notification-channel.js';
import type { Logger } from '../../lib/logger.js';
import type { NotificationLogRepository } from './notification-log.repository.js';
import type { SnapshotsRepository } from './snapshots.repository.js';
import {
  cancellationTemplate,
  confirmationTemplate,
  paymentFailedTemplate,
  reminderTemplate,
} from './templates.js';

export interface AppointmentCreatedPayload {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  dateTime: string;
}

export interface AppointmentStatusChangedPayload {
  appointmentId: string;
  from: string;
  to: string;
  trigger: string;
  refundAmountCents?: number;
}

export interface PatientUpdatedPayload {
  patientId: string;
  email: string;
  name: string;
}

export interface DoctorEventPayload {
  doctorId: string;
  name: string;
  specialty: string;
}

export interface PaymentFailedPayload {
  appointmentId: string;
  paymentIntentId: string;
  reason: string | null;
}

export class NotificationService {
  constructor(
    private readonly snapshots: SnapshotsRepository,
    private readonly channel: NotificationChannel,
    private readonly logs: NotificationLogRepository,
    private readonly logger: Logger,
  ) {}

  async handleAppointmentCreated(payload: AppointmentCreatedPayload): Promise<void> {
    await this.snapshots.upsertAppointment({
      id: payload.appointmentId,
      patientId: payload.patientId,
      doctorId: payload.doctorId,
      dateTime: new Date(payload.dateTime),
      amountCents: 0,
      status: 'PENDING',
    });
  }

  async handleAppointmentStatusChanged(payload: AppointmentStatusChangedPayload): Promise<void> {
    const appointment = await this.snapshots.updateAppointmentStatus(payload.appointmentId, payload.to);
    if (!appointment) {
      // El snapshot todavía no existe (AppointmentCreated no se procesó
      // antes que este evento, posible con consumer groups separados leyendo
      // el mismo stream a distinto ritmo). Se relanza para que el consumer
      // lo reintente — no es un fallo permanente, es una carrera benigna.
      throw new Error(
        `AppointmentSnapshot no encontrado para ${payload.appointmentId} (AppointmentCreated aún no procesado)`,
      );
    }

    switch (payload.to) {
      case 'PAID':
        await this.sendEmail('confirmation', appointment);
        return;
      case 'REMINDED':
        await this.sendEmail('reminder', appointment);
        return;
      case 'CANCELLED':
        await this.sendCancellationEmail(appointment, payload.refundAmountCents ?? 0);
        return;
      default:
        // COMPLETED, NO_SHOW: no hay email asociado en el monolito tampoco.
        return;
    }
  }

  async handlePatientUpdated(payload: PatientUpdatedPayload): Promise<void> {
    await this.snapshots.upsertPatient({ id: payload.patientId, email: payload.email, name: payload.name });
  }

  async handleDoctorEvent(payload: DoctorEventPayload): Promise<void> {
    await this.snapshots.upsertDoctor({
      id: payload.doctorId,
      name: payload.name,
      specialty: payload.specialty,
    });
  }

  async handlePaymentFailed(payload: PaymentFailedPayload): Promise<void> {
    const appointment = await this.snapshots.getAppointment(payload.appointmentId);
    if (!appointment) {
      throw new Error(`AppointmentSnapshot no encontrado para ${payload.appointmentId}`);
    }
    await this.sendEmail('payment-failed', appointment);
  }

  private async sendEmail(
    type: 'confirmation' | 'reminder' | 'payment-failed',
    appointment: AppointmentSnapshot,
  ): Promise<void> {
    const patient = await this.snapshots.getPatient(appointment.patientId);
    if (!patient) {
      throw new Error(`PatientSnapshot no encontrado para ${appointment.patientId}`);
    }

    const dateTime = appointment.dateTime.toLocaleString('es-MX');
    const subjectByType: Record<typeof type, string> = {
      confirmation: 'Cita confirmada - Clínica Scheduler',
      reminder: 'Recordatorio de tu cita - Clínica Scheduler',
      'payment-failed': 'Pago no procesado - Clínica Scheduler',
    };
    const bodyByType: Record<typeof type, string> = {
      confirmation: confirmationTemplate(appointment.id, patient.name, dateTime),
      reminder: reminderTemplate(appointment.id, patient.name, dateTime),
      'payment-failed': paymentFailedTemplate(appointment.id, patient.name),
    };

    await this.deliver(type, appointment.id, patient.email, subjectByType[type], bodyByType[type]);
  }

  private async sendCancellationEmail(
    appointment: AppointmentSnapshot,
    refundAmountCents: number,
  ): Promise<void> {
    const patient = await this.snapshots.getPatient(appointment.patientId);
    if (!patient) {
      throw new Error(`PatientSnapshot no encontrado para ${appointment.patientId}`);
    }

    const refundAmount = (refundAmountCents / 100).toFixed(2);
    const subject = 'Cita cancelada - Reembolso procesado - Clínica Scheduler';
    const body = cancellationTemplate(appointment.id, patient.name, refundAmount);

    await this.deliver('cancellation', appointment.id, patient.email, subject, body);
  }

  private async deliver(
    type: string,
    appointmentId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    // Idempotencia (PLAN.md Fase 3, punto 2): Redis Streams es
    // at-least-once — el mismo AppointmentStatusChanged puede entregarse
    // dos veces (ej. el proceso murió después de enviar el email pero
    // antes del XACK, y el evento se reclama de nuevo). Sin este chequeo,
    // el paciente recibiría el mismo email duplicado.
    const alreadySent = await this.logs.wasAlreadySent(appointmentId, type);
    if (alreadySent) {
      this.logger.info(
        { appointmentId, type, channel: this.channel.name },
        'Notificación ya había sido enviada antes, se ignora (evento duplicado)',
      );
      return;
    }

    try {
      await this.channel.send({ to, subject, body });
      await this.logs.record(appointmentId, this.channel.name, type, 'SENT');
      this.logger.info({ appointmentId, type, channel: this.channel.name }, 'Notificación enviada');
    } catch (error) {
      await this.logs.record(appointmentId, this.channel.name, type, 'FAILED', String(error));
      this.logger.error(
        { err: error, appointmentId, type, channel: this.channel.name },
        'Error al enviar notificación',
      );
      throw error;
    }
  }
}

export interface NotificationServiceDeps {
  snapshots: SnapshotsRepository;
  channel: NotificationChannel;
  logs: NotificationLogRepository;
  logger: Logger;
}

export const buildNotificationService = (deps: NotificationServiceDeps): NotificationService =>
  new NotificationService(deps.snapshots, deps.channel, deps.logs, deps.logger);
