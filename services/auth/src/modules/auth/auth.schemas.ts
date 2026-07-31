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

// RFC-004, escalada de privilegios de platform_support/platform_admin.
// ttlHours acotado 1-8 ("horas, no días") -- default 4.
export const SupportAccessBody = Type.Object({
  tenantId: Type.String({ format: 'uuid' }),
  reason: Type.String({ minLength: 1 }),
  ttlHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
});
export type SupportAccessDto = Static<typeof SupportAccessBody>;
