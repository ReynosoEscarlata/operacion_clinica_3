import { Resend } from 'resend';

import { env } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import type { NotificationChannel, NotificationMessage } from './notification-channel.js';

export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  private readonly resend: Resend;

  constructor(private readonly logger: Logger) {
    this.resend = new Resend(env.RESEND_API_KEY);
  }

  async send(message: NotificationMessage): Promise<void> {
    if (env.NODE_ENV === 'development') {
      // Fase 5 (ADR-013): nunca loguear el email destinatario en texto
      // plano, ni en desarrollo -- el requestId ya correlaciona el envío
      // con el resto de los logs de la request sin necesidad de exponer PII.
      this.logger.info({ subjectLength: message.subject.length }, 'Email (development mode)');
      return;
    }

    await this.resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: message.to,
      subject: message.subject,
      html: message.body,
    });
  }
}

export const buildEmailChannel = (logger: Logger): NotificationChannel => new EmailChannel(logger);
