export interface IdempotencyStore {
  hasProcessed: (key: string) => Promise<boolean>;
  markProcessed: (key: string) => Promise<void>;
}

export const withIdempotency = async (
  _store: IdempotencyStore,
  _key: string,
  _handler: () => Promise<void>,
): Promise<void> => {
  throw new Error('withIdempotency no implementado todavía');
};
