import { requirePermission } from '@clinica/authz';
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
  type CreateCustomerDto,
  type CreatePaymentIntentDto,
  type CreateRefundDto,
  type PaymentIntentIdParamsDto,
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

  // payment:create_customer/create_intent/cancel_intent (RFC-004): "— llamada
  // interna, no expuesta" en la matriz -- el tráfico real es Appointments
  // llamando directo, servicio-a-servicio, SIN pasar por el gateway (ver
  // middleware/tenant-context.ts), así que casi nunca hay un authActor acá.
  // allowAnonymous dejar pasar ese caso común; si alguna vez se llama con un
  // JWT real (ej. un operador), la matriz igual exige platform_admin.
  app.post<{ Body: CreateCustomerDto }>(
    '/v1/customers',
    {
      schema: { body: CreateCustomerBody },
      config: { authz: { permission: 'payment:create_customer', allowAnonymous: true } },
      preHandler: requirePermission('payment:create_customer', { allowAnonymous: true }),
    },
    controller.createCustomer,
  );
  app.post<{ Body: CreatePaymentIntentDto }>(
    '/v1/payment-intents',
    {
      schema: { body: CreatePaymentIntentBody },
      config: { authz: { permission: 'payment:create_intent', allowAnonymous: true } },
      preHandler: requirePermission('payment:create_intent', { allowAnonymous: true }),
    },
    controller.createPaymentIntent,
  );
  app.post<{ Params: PaymentIntentIdParamsDto }>(
    '/v1/payment-intents/:id/cancel',
    {
      schema: { params: PaymentIntentIdParams },
      config: { authz: { permission: 'payment:cancel_intent', allowAnonymous: true } },
      preHandler: requirePermission('payment:cancel_intent', { allowAnonymous: true }),
    },
    controller.cancelPaymentIntent,
  );

  // payment:refund (RFC-004: exclusivo de clinic_owner/platform_admin) --
  // en el código real HOY este endpoint no se llama vía el gateway con un
  // JWT: appointments.service.ts#cancelWithinTenant lo invoca automática y
  // directamente (servicio-a-servicio, sin ningún header de actor) como
  // parte del flujo de cancelación, disparado por CUALQUIER rol que pueda
  // cancelar (incluido el paciente, RFC-004: appointment:cancel es 'own'
  // para patient) -- no existe hoy una acción administrativa separada de
  // "emitir un reembolso" fuera de una cancelación. allowAnonymous deja
  // pasar ese caso real; si en el futuro se expone una acción de refund
  // manual vía el gateway con un JWT propio, la matriz igual la acota a
  // clinic_owner/platform_admin.
  app.post<{ Body: CreateRefundDto }>(
    '/v1/refunds',
    {
      schema: { body: CreateRefundBody },
      config: { authz: { permission: 'payment:refund', allowAnonymous: true } },
      preHandler: requirePermission('payment:refund', { allowAnonymous: true }),
    },
    controller.createRefund,
  );

  // Pública por firma de Stripe verificada (RFC-004), no por JWT -- ver el
  // chequeo de stripe-signature más abajo, independiente de requirePermission.
  app.post(
    '/v1/webhooks/stripe',
    { config: { authz: { public: true } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
    },
  );
};
