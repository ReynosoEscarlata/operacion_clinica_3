import { Type, type Static } from '@sinclair/typebox';

export const CreateCustomerBody = Type.Object({
  email: Type.String({ format: 'email' }),
  name: Type.String({ minLength: 1 }),
});
export type CreateCustomerDto = Static<typeof CreateCustomerBody>;

export const CreatePaymentIntentBody = Type.Object({
  appointmentId: Type.String({ format: 'uuid' }),
  amountCents: Type.Integer({ minimum: 0 }),
  patientStripeCustomerId: Type.Union([Type.String(), Type.Null()]),
});
export type CreatePaymentIntentDto = Static<typeof CreatePaymentIntentBody>;

export const PaymentIntentIdParams = Type.Object({
  id: Type.String({ minLength: 1 }),
});
export type PaymentIntentIdParamsDto = Static<typeof PaymentIntentIdParams>;

export const CreateRefundBody = Type.Object({
  paymentIntentId: Type.String({ minLength: 1 }),
  amountCents: Type.Integer({ minimum: 0 }),
  appointmentId: Type.String({ format: 'uuid' }),
});
export type CreateRefundDto = Static<typeof CreateRefundBody>;
