import { Type, type Static } from '@sinclair/typebox';

export const UserRoleSchema = Type.Union([Type.Literal('ADMIN'), Type.Literal('STAFF')]);

export const CreateUserBody = Type.Object({
  email: Type.String({ format: 'email' }),
  name: Type.String({ minLength: 1 }),
  role: UserRoleSchema,
  password: Type.String({ minLength: 8 }),
});
export type CreateUserDto = Static<typeof CreateUserBody>;

export const UserIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type UserIdParamsDto = Static<typeof UserIdParams>;
