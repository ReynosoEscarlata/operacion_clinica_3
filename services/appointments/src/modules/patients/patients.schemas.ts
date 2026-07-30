import { Type, type Static } from '@sinclair/typebox';

const PhoneSchema = Type.String({ pattern: '^\\+?[0-9 ()-]{7,20}$' });

// doctorId (Fase 3a, RFC-003): no identifica "el doctor del paciente" -- se
// usa únicamente para resolver a qué clínica (tenant) pertenece este
// registro de paciente, igual que ya hace la creación de citas. Un paciente
// es un registro por clínica (decidido con Ricardo): la misma persona
// reservando en dos clínicas distintas genera dos filas Patient separadas.
export const CreatePatientBody = Type.Object({
  doctorId: Type.String({ format: 'uuid' }),
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
  doctorId: Type.String({ format: 'uuid' }),
  email: Type.String({ format: 'email' }),
});
export type FindPatientByEmailQueryDto = Static<typeof FindPatientByEmailQuery>;
