import type { Prisma, PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';

import type { Logger } from '../../lib/logger.js';
import { writeOutboxEvent } from '../../lib/outbox.js';
import type { WebhookEventsRepository } from './webhook-events.repository.js';

// Payments nunca toca la BD de Appointments (RFC-001, cero estado
// compartido): el resultado del webhook se publica como evento de dominio
// (Outbox -> Redis Streams en la Fase 3) y Appointments lo consume para
// avanzar su propia state machine. El appointmentId viaja en los metadata
// del PaymentIntent (ver payments.service.ts), no se busca en ninguna BD.
export class WebhookService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: WebhookEventsRepository,
    private readonly logger: Logger,
  ) {}

  async handleEvent(event: Stripe.Event): Promise<void> {
    const claimed = await this.repository.claim(event);

    if (!claimed) {
      this.logger.info(
        { stripeEventId: event.id },
        'Webhook ya había sido reclamado/procesado anteriormente, se ignora',
      );
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.processEvent(tx, event);
        await tx.webhookEvent.update({
          where: { stripeEventId: event.id },
          data: { processedAt: new Date() },
        });
      });
    } catch (error) {
      // Siempre se responde 200 a Stripe (ver webhooks.handler.ts): un error
      // interno se loguea, pero no debe hacer que Stripe reintente
      // indefinidamente un evento que de todos modos no vamos a poder
      // procesar mejor la próxima vez.
      this.logger.error(
        { err: error, stripeEventId: event.id, type: event.type },
        'Error al procesar webhook de Stripe',
      );
      await this.repository.markProcessed(event.id);
    }
  }

  private async processEvent(tx: Prisma.TransactionClient, event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(tx, event.data.object as Stripe.PaymentIntent);
        return;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(tx, event.data.object as Stripe.PaymentIntent);
        return;
      default:
        this.logger.info(
          { stripeEventId: event.id, type: event.type },
          'Tipo de evento de Stripe sin manejador específico, ignorado',
        );
    }
  }

  private async handlePaymentSucceeded(
    tx: Prisma.TransactionClient,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<void> {
    const appointmentId = paymentIntent.metadata?.['appointmentId'];
    if (!appointmentId) {
      this.logger.warn(
        { stripePaymentIntentId: paymentIntent.id },
        'payment_intent.succeeded: el PaymentIntent no tiene appointmentId en metadata',
      );
      return;
    }

    await writeOutboxEvent(tx, 'PaymentSucceeded', {
      appointmentId,
      paymentIntentId: paymentIntent.id,
      amountCents: paymentIntent.amount,
    });
  }

  private async handlePaymentFailed(
    tx: Prisma.TransactionClient,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<void> {
    const appointmentId = paymentIntent.metadata?.['appointmentId'];
    if (!appointmentId) {
      this.logger.warn(
        { stripePaymentIntentId: paymentIntent.id },
        'payment_intent.payment_failed: el PaymentIntent no tiene appointmentId en metadata',
      );
      return;
    }

    await writeOutboxEvent(tx, 'PaymentFailed', {
      appointmentId,
      paymentIntentId: paymentIntent.id,
      reason: paymentIntent.last_payment_error?.message ?? null,
    });
  }
}

export const buildWebhookService = (
  prisma: PrismaClient,
  repository: WebhookEventsRepository,
  logger: Logger,
): WebhookService => new WebhookService(prisma, repository, logger);
