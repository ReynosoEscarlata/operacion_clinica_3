import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';

import { env } from '../../config/env.js';
import { prisma as defaultPrisma } from '../../config/prisma.js';
import { stripe as defaultStripe } from '../../config/stripe.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { buildPaymentsController } from './payments.controller.js';
import {
  CreateCustomerBody,
  CreatePaymentIntentBody,
  CreateRefundBody,
  PaymentIntentIdParams,
} from './payments.schemas.js';
import { buildPaymentsService, type StripePaymentsClient } from './payments.service.js';
import {
  buildWebhookEventsRepository,
  type WebhookEventsRepository,
} from './webhook-events.repository.js';
import { buildWebhookService } from './webhook.service.js';

export interface StripeWebhooksClient {
  webhooks: {
    constructEvent: (payload: string | Buffer, signature: string, secret: string) => Stripe.Event;
  };
}

export interface PaymentsRoutesDeps {
  stripeClient?: StripePaymentsClient;
  webhooksClient?: StripeWebhooksClient;
  webhookSecret?: string;
  webhookEventsRepository?: WebhookEventsRepository;
}

export const registerPaymentsRoutes = (app: FastifyInstance, deps: PaymentsRoutesDeps = {}): void => {
  const stripeClient = deps.stripeClient ?? defaultStripe;
  const webhooksClient = deps.webhooksClient ?? defaultStripe;
  const webhookSecret = deps.webhookSecret ?? env.STRIPE_WEBHOOK_SECRET;
  const webhookEventsRepository =
    deps.webhookEventsRepository ?? buildWebhookEventsRepository(defaultPrisma);

  const paymentsService = buildPaymentsService(stripeClient, defaultLogger);
  const controller = buildPaymentsController(paymentsService);
  const webhookService = buildWebhookService(defaultPrisma, webhookEventsRepository, defaultLogger);

  app.post('/v1/customers', { schema: { body: CreateCustomerBody } }, controller.createCustomer);
  app.post(
    '/v1/payment-intents',
    { schema: { body: CreatePaymentIntentBody } },
    controller.createPaymentIntent,
  );
  app.post(
    '/v1/payment-intents/:id/cancel',
    { schema: { params: PaymentIntentIdParams } },
    controller.cancelPaymentIntent,
  );
  app.post('/v1/refunds', { schema: { body: CreateRefundBody } }, controller.createRefund);

  app.post('/v1/webhooks/stripe', async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = request.headers['stripe-signature'];

    if (!request.rawBody || typeof signature !== 'string') {
      request.log.warn('Webhook de Stripe sin firma o sin body crudo');
      reply.status(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Firma de webhook inválida', requestId: request.requestId },
      });
      return;
    }

    let event: Stripe.Event;
    try {
      event = webhooksClient.webhooks.constructEvent(request.rawBody, signature, webhookSecret);
    } catch (error) {
      request.log.warn({ err: error }, 'Firma de webhook de Stripe inválida');
      reply.status(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Firma de webhook inválida', requestId: request.requestId },
      });
      return;
    }

    await webhookService.handleEvent(event);

    reply.status(200).send({ received: true });
  });
};
