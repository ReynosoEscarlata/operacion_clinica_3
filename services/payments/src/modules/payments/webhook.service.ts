import type { Prisma, PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';

import type { Logger } from '../../lib/logger.js';
import { writeOutboxEvent } from '../../lib/outbox.js';
import { runWithTenant } from '../../lib/tenant-context.js';
import { withTenantId } from '../../lib/tenant-scoped.js';
import type { WebhookEventsRepository } from './webhook-events.repository.js';

// Payments nunca toca la BD de Appointments (RFC-001, cero estado
// compartido): el resultado del webhook se publica como evento de dominio
// (Outbox -> SNS/SQS, ADR-014) y Appointments lo consume para
// avanzar su propia state machine. El appointmentId Y el tenantId viajan en
// el metadata del PaymentIntent (ver payments.service.ts), no se buscan en
// ninguna BD -- Stripe manda TODOS los eventos, de todos los tenants, a
// este único endpoint compartido, así que el tenant se resuelve por evento,
// no por request (no hay ningún TenantContext ambiental heredado de un
// header aquí, ver middleware/tenant-context.ts).
export class WebhookService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: WebhookEventsRepository,
    private readonly logger: Logger,
  ) {}

  async handleEvent(event: Stripe.Event): Promise<void> {
    const tenantId = this.extractTenantId(event);
    const claimed = await this.repository.claim(event, tenantId);

    if (!claimed) {
      this.logger.info(
        { stripeEventId: event.id },
        'Webhook ya había sido reclamado/procesado anteriormente, se ignora',
      );
      return;
    }

    try {
      await runWithTenant(tenantId, () =>
        withTenantId(this.prisma, tenantId, async (tx) => {
          await this.processEvent(tx, event, tenantId);
          await tx.webhookEvent.update({
            where: { stripeEventId: event.id },
            data: { processedAt: new Date() },
          });
        }),
      );
    } catch (error) {
      // Siempre se responde 200 a Stripe (ver webhooks.handler.ts): un error
      // interno se loguea, pero no debe hacer que Stripe reintente
      // indefinidamente un evento que de todos modos no vamos a poder
      // procesar mejor la próxima vez.
      this.logger.error(
        { err: error, stripeEventId: event.id, type: event.type },
        'Error al procesar webhook de Stripe',
      );
      await this.repository.markProcessed(event.id, tenantId);
    }
  }

  // El PaymentIntent es el único objeto de Stripe con nuestro metadata
  // propio (ver payments.service.ts) -- otros tipos de evento (ej.
  // charge.refunded) no lo tienen, y por lo tanto no resuelven a ningún
  // tenant (null, ver WebhookEvent.tenantId nullable en schema.prisma).
  private extractTenantId(event: Stripe.Event): string | null {
    const object = event.data.object as { metadata?: Record<string, string> };
    return object?.metadata?.['tenantId'] ?? null;
  }

  private async processEvent(
    tx: Prisma.TransactionClient,
    event: Stripe.Event,
    tenantId: string | null,
  ): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(tx, event.data.object as Stripe.PaymentIntent, tenantId);
        return;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(tx, event.data.object as Stripe.PaymentIntent, tenantId);
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
    tenantId: string | null,
  ): Promise<void> {
    const appointmentId = paymentIntent.metadata?.['appointmentId'];
    if (!appointmentId) {
      this.logger.warn(
        { stripePaymentIntentId: paymentIntent.id },
        'payment_intent.succeeded: el PaymentIntent no tiene appointmentId en metadata',
      );
      return;
    }
    if (!tenantId) {
      this.logger.warn(
        { stripePaymentIntentId: paymentIntent.id, appointmentId },
        'payment_intent.succeeded: el PaymentIntent no tiene tenantId en metadata, se descarta',
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
    tenantId: string | null,
  ): Promise<void> {
    const appointmentId = paymentIntent.metadata?.['appointmentId'];
    if (!appointmentId) {
      this.logger.warn(
        { stripePaymentIntentId: paymentIntent.id },
        'payment_intent.payment_failed: el PaymentIntent no tiene appointmentId en metadata',
      );
      return;
    }
    if (!tenantId) {
      this.logger.warn(
        { stripePaymentIntentId: paymentIntent.id, appointmentId },
        'payment_intent.payment_failed: el PaymentIntent no tiene tenantId en metadata, se descarta',
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
