import { Type, type Static } from '@sinclair/typebox';

export const DeadLetterIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type DeadLetterIdParamsDto = Static<typeof DeadLetterIdParams>;
