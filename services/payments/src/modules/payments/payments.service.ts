import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';

export interface StripePaymentsClient {
  customers: {
    create: (params: { email: string; name: string }) => Promise<{ id: string }>;
  };
  paymentIntents: {
    create: (params: {
      amount: number;
      currency: string;
      customer?: string;
      metadata: Record<string, string>;
      automatic_payment_methods?: { enabled: boolean };
    }) => Promise<{ id: string; client_secret: string | null }>;
    cancel: (paymentIntentId: string) => Promise<unknown>;
  };
  refunds: {
    create: (params: { payment_intent: string; amount?: number }) => Promise<{ id: string }>;
  };
}

export interface CreatePaymentIntentResult {
  id: string;
  clientSecret: string | null;
}

// Cada cita procesada por Appointments necesita poder mapearse de vuelta
// desde un webhook de Stripe sin que Payments consulte la BD de
// Appointments (cero estado compartido, RFC-001) — por eso el
// appointmentId viaja en los metadata del PaymentIntent. El webhook lo lee
// de ahí, no de una tabla propia.
export class PaymentsService {
  constructor(
    private readonly stripeClient: StripePaymentsClient,
    private readonly logger: Logger,
  ) {}

  async createCustomer(email: string, name: string): Promise<{ id: string }> {
    try {
      return await this.stripeClient.customers.create({ email, name });
    } catch (error) {
      this.logger.error({ err: error, operation: 'createCustomer', email }, 'Error al crear Stripe Customer');
      throw new AppError(502, 'STRIPE_UNAVAILABLE', 'Servicio de pago no disponible');
    }
  }

  async createPaymentIntent(
    appointmentId: string,
    amountCents: number,
    patientStripeCustomerId: string | null,
  ): Promise<CreatePaymentIntentResult> {
    try {
      const paymentIntent = await this.stripeClient.paymentIntents.create({
        amount: amountCents,
        currency: 'mxn',
        ...(patientStripeCustomerId ? { customer: patientStripeCustomerId } : {}),
        metadata: { appointmentId },
        automatic_payment_methods: { enabled: true },
      });
      return { id: paymentIntent.id, clientSecret: paymentIntent.client_secret };
    } catch (error) {
      this.logger.error(
        { err: error, operation: 'createPaymentIntent', appointmentId },
        'Error al crear PaymentIntent en Stripe',
      );
      throw new AppError(502, 'STRIPE_UNAVAILABLE', 'Servicio de pago no disponible');
    }
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    try {
      await this.stripeClient.paymentIntents.cancel(paymentIntentId);
    } catch (error) {
      this.logger.error(
        { err: error, operation: 'cancelPaymentIntent', paymentIntentId },
        'Error al cancelar PaymentIntent en Stripe',
      );
      throw new AppError(502, 'STRIPE_UNAVAILABLE', 'Servicio de pago no disponible');
    }
  }

  async createRefund(paymentIntentId: string, amountCents: number): Promise<{ id: string }> {
    try {
      return await this.stripeClient.refunds.create({
        payment_intent: paymentIntentId,
        amount: amountCents,
      });
    } catch (error) {
      this.logger.error(
        { err: error, operation: 'createRefund', paymentIntentId, amountCents },
        'Error al procesar el reembolso en Stripe',
      );
      throw new AppError(502, 'STRIPE_REFUND_FAILED', 'No se pudo procesar el reembolso, contacte a soporte');
    }
  }
}

export const buildPaymentsService = (
  stripeClient: StripePaymentsClient,
  logger: Logger,
): PaymentsService => new PaymentsService(stripeClient, logger);
