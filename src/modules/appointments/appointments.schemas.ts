import { Type, type Static } from '@sinclair/typebox';

export const CreateAppointmentBody = Type.Object({
  patientId: Type.String({ format: 'uuid' }),
  doctorId: Type.String({ format: 'uuid' }),
  dateTime: Type.String({ format: 'date-time' }),
});
export type CreateAppointmentDto = Static<typeof CreateAppointmentBody>;

export const AppointmentIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type AppointmentIdParamsDto = Static<typeof AppointmentIdParams>;

export const CancelAppointmentBody = Type.Object({
  reason: Type.Optional(Type.String({ minLength: 1 })),
});
export type CancelAppointmentDto = Static<typeof CancelAppointmentBody>;

const AppointmentStatusEnum = Type.Union([
  Type.Literal('PENDING'),
  Type.Literal('CONFIRMED'),
  Type.Literal('PAID'),
  Type.Literal('REMINDED'),
  Type.Literal('COMPLETED'),
  Type.Literal('CANCELLED'),
  Type.Literal('NO_SHOW'),
]);

export const ListAppointmentsQuery = Type.Object({
  status: Type.Optional(AppointmentStatusEnum),
  doctorId: Type.Optional(Type.String({ format: 'uuid' })),
  patientId: Type.Optional(Type.String({ format: 'uuid' })),
  date: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
});
export type ListAppointmentsQueryDto = Static<typeof ListAppointmentsQuery>;
