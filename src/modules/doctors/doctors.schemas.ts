import { Type, type Static } from '@sinclair/typebox';

const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

export const CreateDoctorBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  email: Type.String({ format: 'email' }),
  specialty: Type.String({ minLength: 1 }),
});
export type CreateDoctorDto = Static<typeof CreateDoctorBody>;

export const DoctorIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type DoctorIdParamsDto = Static<typeof DoctorIdParams>;

export const AvailabilityBlock = Type.Object({
  dayOfWeek: Type.Integer({ minimum: 0, maximum: 6 }),
  startTime: Type.String({ pattern: TIME_PATTERN }),
  endTime: Type.String({ pattern: TIME_PATTERN }),
});
export type AvailabilityBlockDto = Static<typeof AvailabilityBlock>;

export const SetAvailabilityBody = Type.Object({
  availability: Type.Array(AvailabilityBlock, { minItems: 1 }),
});
export type SetAvailabilityDto = Static<typeof SetAvailabilityBody>;

export const GetSlotsQuery = Type.Object({
  date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
});
export type GetSlotsQueryDto = Static<typeof GetSlotsQuery>;
