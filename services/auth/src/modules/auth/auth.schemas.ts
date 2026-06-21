import { Type, type Static } from '@sinclair/typebox';

export const LoginBody = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 1 }),
});
export type LoginDto = Static<typeof LoginBody>;

export const RefreshBody = Type.Object({
  refreshToken: Type.String({ minLength: 1 }),
});
export type RefreshDto = Static<typeof RefreshBody>;
