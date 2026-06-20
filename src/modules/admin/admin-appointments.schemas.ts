import { Type, type Static } from '@sinclair/typebox';

const AppointmentStatusEnum = Type.Union([
  Type.Literal('PENDING'),
  Type.Literal('CONFIRMED'),
  Type.Literal('PAID'),
  Type.Literal('REMINDED'),
  Type.Literal('COMPLETED'),
  Type.Literal('CANCELLED'),
  Type.Literal('NO_SHOW'),
]);

export const AdminAppointmentIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type AdminAppointmentIdParamsDto = Static<typeof AdminAppointmentIdParams>;

export const AdminListAppointmentsQuery = Type.Object({
  status: Type.Optional(AppointmentStatusEnum),
  doctorId: Type.Optional(Type.String({ format: 'uuid' })),
  patientId: Type.Optional(Type.String({ format: 'uuid' })),
  dateFrom: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  dateTo: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  cursor: Type.Optional(Type.String({ format: 'uuid' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type AdminListAppointmentsQueryDto = Static<typeof AdminListAppointmentsQuery>;

export const AdminCancelAppointmentBody = Type.Object({
  reason: Type.String({ minLength: 1 }),
});
export type AdminCancelAppointmentDto = Static<typeof AdminCancelAppointmentBody>;

export const AdminEventsQuery = Type.Object({
  hours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});
export type AdminEventsQueryDto = Static<typeof AdminEventsQuery>;
