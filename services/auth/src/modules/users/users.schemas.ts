import { Type, type Static } from '@sinclair/typebox';

// RFC-004-rbac.md: los 6 roles con cuenta (patient excluido, RFC-001).
export const UserRoleSchema = Type.Union([
  Type.Literal('PLATFORM_ADMIN'),
  Type.Literal('PLATFORM_SUPPORT'),
  Type.Literal('CLINIC_OWNER'),
  Type.Literal('CLINIC_ADMIN'),
  Type.Literal('DOCTOR'),
  Type.Literal('RECEPTIONIST'),
]);

export const CreateUserBody = Type.Object({
  email: Type.String({ format: 'email' }),
  name: Type.String({ minLength: 1 }),
  role: UserRoleSchema,
  password: Type.String({ minLength: 8 }),
  // Solo para role = DOCTOR -- users.service.ts valida la correlación
  // (ver CANNOT_ASSIGN_PLATFORM_ROLE / DOCTOR_ID_REQUIRED).
  doctorId: Type.Optional(Type.String({ format: 'uuid' })),
});
export type CreateUserDto = Static<typeof CreateUserBody>;

export const UserIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type UserIdParamsDto = Static<typeof UserIdParams>;
