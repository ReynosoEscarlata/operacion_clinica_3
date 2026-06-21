import { describe, expect, it, vi } from 'vitest';

import { buildPaymentsService, type StripePaymentsClient } from '../../src/modules/payments/payments.service.js';
import { logger } from '../../src/lib/logger.js';

const buildFakeStripeClient = (): StripePaymentsClient => ({
  customers: { create: vi.fn().mockResolvedValue({ id: 'cus_1' }) },
  paymentIntents: {
    create: vi.fn().mockResolvedValue({ id: 'pi_1', client_secret: 'secret_1' }),
    cancel: vi.fn().mockResolvedValue({}),
  },
  refunds: { create: vi.fn().mockResolvedValue({ id: 're_1' }) },
});

describe('PaymentsService', () => {
  it('crea un customer', async () => {
    const stripeClient = buildFakeStripeClient();
    const service = buildPaymentsService(stripeClient, logger);

    const result = await service.createCustomer('a@a.com', 'A');

    expect(result).toEqual({ id: 'cus_1' });
    expect(stripeClient.customers.create).toHaveBeenCalledWith({ email: 'a@a.com', name: 'A' });
  });

  it('crea un PaymentIntent con el appointmentId en metadata', async () => {
    const stripeClient = buildFakeStripeClient();
    const service = buildPaymentsService(stripeClient, logger);

    const result = await service.createPaymentIntent('apt-1', 50_000, 'cus_1');

    expect(result).toEqual({ id: 'pi_1', clientSecret: 'secret_1' });
    expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50_000, metadata: { appointmentId: 'apt-1' }, customer: 'cus_1' }),
    );
  });

  it('lanza STRIPE_UNAVAILABLE si Stripe falla al crear el PaymentIntent', async () => {
    const stripeClient = buildFakeStripeClient();
    stripeClient.paymentIntents.create = vi.fn().mockRejectedValue(new Error('down'));
    const service = buildPaymentsService(stripeClient, logger);

    await expect(service.createPaymentIntent('apt-1', 50_000, null)).rejects.toMatchObject({
      code: 'STRIPE_UNAVAILABLE',
      statusCode: 502,
    });
  });

  it('lanza STRIPE_REFUND_FAILED si Stripe falla al reembolsar', async () => {
    const stripeClient = buildFakeStripeClient();
    stripeClient.refunds.create = vi.fn().mockRejectedValue(new Error('down'));
    const service = buildPaymentsService(stripeClient, logger);

    await expect(service.createRefund('pi_1', 1000)).rejects.toMatchObject({
      code: 'STRIPE_REFUND_FAILED',
    });
  });
});
