import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';

import { env } from '../../config/env.js';
import { prisma as defaultPrisma } from '../../config/prisma.js';
import { Sentry } from '../../config/sentry.js';
import { stripe as defaultStripe } from '../../config/stripe.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { enqueueAppointmentReminder } from '../../queues/jobs/reminder.job.js';
import { enqueueEmailJob } from '../../queues/jobs/email.job.js';
import { buildAppointmentRepository, type AppointmentRepository } from '../appointments/appointments.repository.js';
import { buildStateMachine, type AppointmentStateMachine } from '../appointments/state-machine.js';
import { buildPaymentsService } from './payments.service.js';

export interface StripeWebhooksClient {
  webhooks: {
    constructEvent: (payload: string | Buffer, signature: string, secret: string) => Stripe.Event;
  };
}

export interface WebhookRoutesDeps {
  stripeClient?: StripeWebhooksClient;
  webhookSecret?: string;
  appointmentRepository?: AppointmentRepository;
  stateMachine?: AppointmentStateMachine;
  enqueueEmail?: (type: 'confirmation' | 'payment-failed' | 'cancellation', appointmentId: string, requestId?: string) => Promise<void>;
  enqueueReminder?: (appointmentId: string, dateTime: Date, requestId?: string) => Promise<void>;
}

export const registerWebhookRoutes = (app: FastifyInstance, deps: WebhookRoutesDeps = {}): void => {
  const stripeClient = deps.stripeClient ?? defaultStripe;
  const webhookSecret = deps.webhookSecret ?? env.STRIPE_WEBHOOK_SECRET;
  const appointmentRepository = deps.appointmentRepository ?? buildAppointmentRepository(defaultPrisma);
  const stateMachine = deps.stateMachine ?? buildStateMachine(defaultPrisma, defaultLogger);
  const enqueueEmail = deps.enqueueEmail ?? enqueueEmailJob;
  const enqueueReminder = deps.enqueueReminder ?? enqueueAppointmentReminder;

  const paymentsService = buildPaymentsService({
    prisma: defaultPrisma,
    appointmentRepository,
    stateMachine,
    enqueueEmail,
    enqueueReminder,
    logger: defaultLogger,
  });

  app.post('/api/webhooks/stripe', async (request: FastifyRequest, reply: FastifyReply) => {
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
      event = stripeClient.webhooks.constructEvent(request.rawBody, signature, webhookSecret);
    } catch (error) {
      request.log.warn({ err: error }, 'Firma de webhook de Stripe inválida');
      Sentry.captureException(error, { tags: { requestId: request.requestId } });
      reply.status(401).send({
        error: { code: 'INVALID_SIGNATURE', message: 'Firma de webhook inválida', requestId: request.requestId },
      });
      return;
    }

    await paymentsService.handleEvent(event, request.requestId);

    reply.status(200).send({ received: true });
  });
};
