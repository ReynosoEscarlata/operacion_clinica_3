import type { FastifyReply, FastifyRequest } from 'fastify';

import type {
  CreateCustomerDto,
  CreatePaymentIntentDto,
  CreateRefundDto,
  PaymentIntentIdParamsDto,
} from './payments.schemas.js';
import type { PaymentsService } from './payments.service.js';

export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  createCustomer = async (
    request: FastifyRequest<{ Body: CreateCustomerDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const customer = await this.service.createCustomer(request.body.email, request.body.name);
    reply.status(201).send(customer);
  };

  createPaymentIntent = async (
    request: FastifyRequest<{ Body: CreatePaymentIntentDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.createPaymentIntent(
      request.body.appointmentId,
      request.body.amountCents,
      request.body.patientStripeCustomerId,
    );
    reply.status(201).send({ id: result.id, clientSecret: result.clientSecret });
  };

  cancelPaymentIntent = async (
    request: FastifyRequest<{ Params: PaymentIntentIdParamsDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await this.service.cancelPaymentIntent(request.params.id);
    reply.send({ id: request.params.id, status: 'CANCELLED' });
  };

  createRefund = async (
    request: FastifyRequest<{ Body: CreateRefundDto }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const refund = await this.service.createRefund(
      request.body.paymentIntentId,
      request.body.amountCents,
    );
    reply.status(201).send(refund);
  };
}

export const buildPaymentsController = (service: PaymentsService): PaymentsController =>
  new PaymentsController(service);
