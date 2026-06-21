import { Type, type Static } from '@sinclair/typebox';

const PhoneSchema = Type.String({ pattern: '^\\+?[0-9 ()-]{7,20}$' });

export const CreatePatientBody = Type.Object({
  email: Type.String({ format: 'email' }),
  name: Type.String({ minLength: 1 }),
  phone: PhoneSchema,
});
export type CreatePatientDto = Static<typeof CreatePatientBody>;

export const UpdatePatientBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  phone: Type.Optional(PhoneSchema),
});
export type UpdatePatientDto = Static<typeof UpdatePatientBody>;

export const PatientIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type PatientIdParamsDto = Static<typeof PatientIdParams>;

export const ListPatientsQuery = Type.Object({
  cursor: Type.Optional(Type.String({ format: 'uuid' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type ListPatientsQueryDto = Static<typeof ListPatientsQuery>;

export const FindPatientByEmailQuery = Type.Object({
  email: Type.String({ format: 'email' }),
});
export type FindPatientByEmailQueryDto = Static<typeof FindPatientByEmailQuery>;
