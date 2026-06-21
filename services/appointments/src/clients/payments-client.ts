import { AppError } from '../lib/app-error.js';

export interface PaymentIntentResult {
  id: string;
  clientSecret: string | null;
}

// Llamadas síncronas según ADR-001-sync-vs-async.md: el paciente necesita
// el clientSecret (creación) o el monto reembolsado (cancelación) en la
// misma respuesta HTTP. La confirmación async del pago (PaymentSucceeded/
// PaymentFailed vía evento) no se modela aquí — eso es lo que consume el
// futuro relay del Outbox (Fase 3 del plan), no una llamada de este cliente.
export interface PaymentsClient {
  createCustomer: (email: string, name: string) => Promise<{ id: string }>;
  createPaymentIntent: (
    appointmentId: string,
    amountCents: number,
    patientStripeCustomerId: string | null,
  ) => Promise<PaymentIntentResult>;
  cancelPaymentIntent: (paymentIntentId: string) => Promise<void>;
  createRefund: (
    paymentIntentId: string,
    amountCents: number,
    appointmentId: string,
  ) => Promise<{ id: string }>;
}

const PAYMENTS_UNAVAILABLE = (): never => {
  throw new AppError(502, 'PAYMENTS_UNAVAILABLE', 'Servicio de pago no disponible');
};

export const buildHttpPaymentsClient = (baseUrl: string): PaymentsClient => ({
  createCustomer: async (email, name) => {
    const response = await fetch(`${baseUrl}/v1/customers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name }),
    }).catch(PAYMENTS_UNAVAILABLE);
    if (!response.ok) {
      return PAYMENTS_UNAVAILABLE();
    }
    return (await response.json()) as { id: string };
  },

  createPaymentIntent: async (appointmentId, amountCents, patientStripeCustomerId) => {
    const response = await fetch(`${baseUrl}/v1/payment-intents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appointmentId,
        amountCents,
        patientStripeCustomerId,
      }),
    }).catch(PAYMENTS_UNAVAILABLE);
    if (!response.ok) {
      return PAYMENTS_UNAVAILABLE();
    }
    const body = (await response.json()) as { id: string; clientSecret: string | null };
    return { id: body.id, clientSecret: body.clientSecret };
  },

  cancelPaymentIntent: async (paymentIntentId) => {
    const response = await fetch(`${baseUrl}/v1/payment-intents/${paymentIntentId}/cancel`, {
      method: 'POST',
    }).catch(PAYMENTS_UNAVAILABLE);
    if (!response.ok) {
      PAYMENTS_UNAVAILABLE();
    }
  },

  createRefund: async (paymentIntentId, amountCents, appointmentId) => {
    const response = await fetch(`${baseUrl}/v1/refunds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentIntentId, amountCents, appointmentId }),
    }).catch(PAYMENTS_UNAVAILABLE);
    if (!response.ok) {
      return PAYMENTS_UNAVAILABLE();
    }
    return (await response.json()) as { id: string };
  },
});
