import { Type, type Static } from '@sinclair/typebox';

export const RecentEventsQuery = Type.Object({
  hours: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 30 })),
});
export type RecentEventsQueryDto = Static<typeof RecentEventsQuery>;

export const DeadLetterIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type DeadLetterIdParamsDto = Static<typeof DeadLetterIdParams>;
