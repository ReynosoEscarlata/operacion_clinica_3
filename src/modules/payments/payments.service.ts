import type { Prisma, PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';

import { Sentry } from '../../config/sentry.js';
import type { Logger } from '../../lib/logger.js';
import type { AppointmentRepository } from '../appointments/appointments.repository.js';
import type { AppointmentStateMachine } from '../appointments/state-machine.js';
import type { EmailJobType } from '../../queues/jobs/email.job.js';

const WEBHOOK_UNIQUE_CONSTRAINT_CODE = 'P2002';

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === WEBHOOK_UNIQUE_CONSTRAINT_CODE;

export interface PaymentsServiceDeps {
  prisma: PrismaClient;
  appointmentRepository: AppointmentRepository;
  stateMachine: AppointmentStateMachine;
  enqueueEmail: (type: EmailJobType, appointmentId: string, requestId?: string) => Promise<void>;
  enqueueReminder: (appointmentId: string, dateTime: Date, requestId?: string) => Promise<void>;
  logger: Logger;
}

export class PaymentsService {
  constructor(private readonly deps: PaymentsServiceDeps) {}

  async handleEvent(event: Stripe.Event, requestId?: string): Promise<void> {
    const claimed = await this.claimEvent(event);

    if (!claimed) {
      this.deps.logger.info(
        { stripeEventId: event.id },
        'Webhook ya había sido reclamado/procesado anteriormente, se ignora',
      );
      return;
    }

    try {
      await this.processEvent(event, requestId);
    } catch (error) {
      // Siempre se responde 200 a Stripe (ver webhooks.handler.ts): un error
      // interno se loguea y reporta, pero no debe hacer que Stripe reintente
      // indefinidamente un evento que de todos modos no vamos a poder procesar.
      this.deps.logger.error(
        { err: error, stripeEventId: event.id, type: event.type },
        'Error al procesar webhook de Stripe',
      );
      Sentry.captureException(error, { extra: { stripeEventId: event.id, type: event.type } });
    }

    await this.markProcessed(event.id);
  }

  private async claimEvent(event: Stripe.Event): Promise<boolean> {
    try {
      await this.deps.prisma.webhookEvent.create({
        data: {
          stripeEventId: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonObject,
          processedAt: null,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  private async markProcessed(stripeEventId: string): Promise<void> {
    await this.deps.prisma.webhookEvent.update({
      where: { stripeEventId },
      data: { processedAt: new Date() },
    });
  }

  private async processEvent(event: Stripe.Event, requestId?: string): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent, requestId);
        return;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.PaymentIntent, requestId);
        return;
      case 'charge.refunded':
        await this.handleChargeRefunded(event.data.object as Stripe.Charge);
        return;
      default:
        this.deps.logger.info(
          { stripeEventId: event.id, type: event.type },
          'Tipo de evento de Stripe sin manejador específico, ignorado',
        );
    }
  }

  private async handlePaymentSucceeded(
    paymentIntent: Stripe.PaymentIntent,
    requestId?: string,
  ): Promise<void> {
    const appointment = await this.deps.appointmentRepository.findByPaymentIntentId(paymentIntent.id);
    if (!appointment) {
      this.deps.logger.warn(
        { stripePaymentIntentId: paymentIntent.id },
        'payment_intent.succeeded: no se encontró una cita asociada',
      );
      return;
    }

    const updated = await this.deps.stateMachine.transition(appointment.id, 'PAID', {
      trigger: 'webhook',
      eventType: 'PAYMENT_RECEIVED',
      eventPayload: { stripePaymentIntentId: paymentIntent.id },
    });

    await this.deps.enqueueEmail('confirmation', appointment.id, requestId);
    await this.deps.enqueueReminder(appointment.id, updated.dateTime, requestId);
  }

  private async handlePaymentFailed(
    paymentIntent: Stripe.PaymentIntent,
    requestId?: string,
  ): Promise<void> {
    const appointment = await this.deps.appointmentRepository.findByPaymentIntentId(paymentIntent.id);
    if (!appointment) {
      this.deps.logger.warn(
        { stripePaymentIntentId: paymentIntent.id },
        'payment_intent.payment_failed: no se encontró una cita asociada',
      );
      return;
    }

    await this.deps.appointmentRepository.addEvent(appointment.id, 'PAYMENT_FAILED', {
      stripePaymentIntentId: paymentIntent.id,
      lastPaymentError: paymentIntent.last_payment_error?.message ?? null,
    });

    await this.deps.enqueueEmail('payment-failed', appointment.id, requestId);
  }

  private async handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const paymentIntentId =
      typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;

    if (!paymentIntentId) {
      this.deps.logger.warn(
        { chargeId: charge.id },
        'charge.refunded: el charge no tiene payment_intent asociado',
      );
      return;
    }

    const appointment = await this.deps.appointmentRepository.findByPaymentIntentId(paymentIntentId);
    if (!appointment) {
      this.deps.logger.warn(
        { chargeId: charge.id, stripePaymentIntentId: paymentIntentId },
        'charge.refunded: no se encontró una cita asociada',
      );
      return;
    }

    await this.deps.appointmentRepository.addEvent(appointment.id, 'CANCELLED', {
      source: 'webhook',
      chargeId: charge.id,
      amountRefunded: charge.amount_refunded,
    });

    this.deps.logger.info(
      { appointmentId: appointment.id, chargeId: charge.id, amountRefunded: charge.amount_refunded },
      'Refund confirmado por Stripe',
    );
  }
}

export const buildPaymentsService = (deps: PaymentsServiceDeps): PaymentsService =>
  new PaymentsService(deps);
