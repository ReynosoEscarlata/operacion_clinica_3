import type { Appointment, Patient } from '@prisma/client';
import { Resend } from 'resend';

import { env } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';

export interface EmailService {
  sendConfirmationEmail: (appointment: Appointment, patient: Pick<Patient, 'name' | 'email'>) => Promise<void>;
  sendReminderEmail: (appointment: Appointment, patient: Pick<Patient, 'name' | 'email'>) => Promise<void>;
  sendCancellationEmail: (appointment: Appointment, patient: Pick<Patient, 'name' | 'email'>) => Promise<void>;
  sendPaymentFailedEmail: (appointment: Appointment, patient: Pick<Patient, 'name' | 'email'>) => Promise<void>;
}

const CLINIC_NAME = 'Clínica Scheduler';

// Templates HTML simples en desarrollo
const confirmationTemplate = (appointmentId: string, patientName: string, dateTime: string): string => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; line-height: 1.5; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 20px; }
      .content { background-color: #f7f9fc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
      .footer { color: #475569; font-size: 12px; text-align: center; }
      .status-badge { display: inline-block; background-color: #e8f0fe; color: #2563eb; padding: 4px 12px; border-radius: 16px; font-weight: 500; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${CLINIC_NAME}</h1>
      </div>
      <div class="content">
        <p>Hola ${patientName},</p>
        <p>Tu cita ha sido confirmada exitosamente.</p>
        <p>
          <strong>ID de cita:</strong> ${appointmentId.substring(0, 8)}<br>
          <strong>Fecha y hora:</strong> ${dateTime}<br>
          <strong>Estado:</strong> <span class="status-badge">PAGADA</span>
        </p>
        <p>Recibirás un recordatorio 24 horas antes de tu cita.</p>
        <p>Si necesitas cancelar o reprogramar, por favor contacta con nosotros.</p>
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} ${CLINIC_NAME}. Todos los derechos reservados.</p>
      </div>
    </div>
  </body>
</html>
`;

const reminderTemplate = (appointmentId: string, patientName: string, dateTime: string): string => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; line-height: 1.5; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background-color: #d97706; color: white; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 20px; }
      .content { background-color: #f7f9fc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
      .footer { color: #475569; font-size: 12px; text-align: center; }
      .status-badge { display: inline-block; background-color: #fef3c7; color: #d97706; padding: 4px 12px; border-radius: 16px; font-weight: 500; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${CLINIC_NAME}</h1>
      </div>
      <div class="content">
        <p>Hola ${patientName},</p>
        <p><strong>Recordatorio:</strong> Tu cita está programada para mañana.</p>
        <p>
          <strong>ID de cita:</strong> ${appointmentId.substring(0, 8)}<br>
          <strong>Fecha y hora:</strong> ${dateTime}<br>
          <strong>Estado:</strong> <span class="status-badge">RECORDATORIO</span>
        </p>
        <p>Por favor, presenta en la clínica 10 minutos antes de tu cita.</p>
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} ${CLINIC_NAME}. Todos los derechos reservados.</p>
      </div>
    </div>
  </body>
</html>
`;

const cancellationTemplate = (
  appointmentId: string,
  patientName: string,
  refundAmount: string,
): string => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; line-height: 1.5; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 20px; }
      .content { background-color: #f7f9fc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
      .footer { color: #475569; font-size: 12px; text-align: center; }
      .status-badge { display: inline-block; background-color: #fee2e2; color: #dc2626; padding: 4px 12px; border-radius: 16px; font-weight: 500; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${CLINIC_NAME}</h1>
      </div>
      <div class="content">
        <p>Hola ${patientName},</p>
        <p>Tu cita ha sido cancelada.</p>
        <p>
          <strong>ID de cita:</strong> ${appointmentId.substring(0, 8)}<br>
          <strong>Reembolso:</strong> $${refundAmount}<br>
          <strong>Estado:</strong> <span class="status-badge">CANCELADA</span>
        </p>
        <p>El reembolso será procesado en 3-5 días hábiles.</p>
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} ${CLINIC_NAME}. Todos los derechos reservados.</p>
      </div>
    </div>
  </body>
</html>
`;

const paymentFailedTemplate = (appointmentId: string, patientName: string): string => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; line-height: 1.5; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 20px; }
      .content { background-color: #f7f9fc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
      .footer { color: #475569; font-size: 12px; text-align: center; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${CLINIC_NAME}</h1>
      </div>
      <div class="content">
        <p>Hola ${patientName},</p>
        <p>Nos comunicamos porque el pago de tu cita no pudo ser procesado.</p>
        <p>
          <strong>ID de cita:</strong> ${appointmentId.substring(0, 8)}<br>
          Por favor, intenta de nuevo o contacta con nuestro soporte.
        </p>
        <p>Tu cita será cancelada automáticamente en 30 minutos si no completas el pago.</p>
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} ${CLINIC_NAME}. Todos los derechos reservados.</p>
      </div>
    </div>
  </body>
</html>
`;

export class ResendEmailService implements EmailService {
  private readonly resend: Resend;

  constructor(private readonly logger: Logger) {
    this.resend = new Resend(env.RESEND_API_KEY);
  }

  async sendConfirmationEmail(appointment: Appointment, patient: Pick<Patient, 'name' | 'email'>): Promise<void> {
    const dateTime = appointment.dateTime.toLocaleString('es-MX');

    if (env.NODE_ENV === 'development') {
      this.logger.info(
        {
          appointmentId: appointment.id,
          patientEmail: patient.email,
          type: 'confirmation',
        },
        'Email de confirmación (development mode)',
      );
      return;
    }

    await this.resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: patient.email,
      subject: 'Cita confirmada - Clínica Scheduler',
      html: confirmationTemplate(appointment.id, patient.name, dateTime),
    });

    this.logger.info(
      {
        appointmentId: appointment.id,
        patientEmail: patient.email,
        type: 'confirmation',
      },
      'Email de confirmación enviado',
    );
  }

  async sendReminderEmail(appointment: Appointment, patient: Pick<Patient, 'name' | 'email'>): Promise<void> {
    const dateTime = appointment.dateTime.toLocaleString('es-MX');

    if (env.NODE_ENV === 'development') {
      this.logger.info(
        {
          appointmentId: appointment.id,
          patientEmail: patient.email,
          type: 'reminder',
        },
        'Email de recordatorio (development mode)',
      );
      return;
    }

    await this.resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: patient.email,
      subject: 'Recordatorio de tu cita - Clínica Scheduler',
      html: reminderTemplate(appointment.id, patient.name, dateTime),
    });

    this.logger.info(
      {
        appointmentId: appointment.id,
        patientEmail: patient.email,
        type: 'reminder',
      },
      'Email de recordatorio enviado',
    );
  }

  async sendCancellationEmail(appointment: Appointment, patient: Pick<Patient, 'name' | 'email'>): Promise<void> {
    // Cálculo del refund basado en SPEC.md: >=24h antes → completo (100%), <24h → 50%
    const hoursUntil = (appointment.dateTime.getTime() - Date.now()) / (1000 * 60 * 60);
    const refundPercentage = hoursUntil >= 24 ? 100 : 50;
    const refundAmount = ((appointment.amountCents / 100) * refundPercentage).toFixed(2);

    if (env.NODE_ENV === 'development') {
      this.logger.info(
        {
          appointmentId: appointment.id,
          patientEmail: patient.email,
          type: 'cancellation',
          refundAmount,
        },
        'Email de cancelación (development mode)',
      );
      return;
    }

    await this.resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: patient.email,
      subject: 'Cita cancelada - Reembolso procesado - Clínica Scheduler',
      html: cancellationTemplate(appointment.id, patient.name, refundAmount),
    });

    this.logger.info(
      {
        appointmentId: appointment.id,
        patientEmail: patient.email,
        type: 'cancellation',
        refundAmount,
      },
      'Email de cancelación enviado',
    );
  }

  async sendPaymentFailedEmail(appointment: Appointment, patient: Pick<Patient, 'name' | 'email'>): Promise<void> {
    if (env.NODE_ENV === 'development') {
      this.logger.info(
        {
          appointmentId: appointment.id,
          patientEmail: patient.email,
          type: 'payment-failed',
        },
        'Email de pago fallido (development mode)',
      );
      return;
    }

    await this.resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: patient.email,
      subject: 'Pago no procesado - Clínica Scheduler',
      html: paymentFailedTemplate(appointment.id, patient.name),
    });

    this.logger.info(
      {
        appointmentId: appointment.id,
        patientEmail: patient.email,
        type: 'payment-failed',
      },
      'Email de pago fallido enviado',
    );
  }
}

export const buildEmailService = (logger: Logger): EmailService => new ResendEmailService(logger);
