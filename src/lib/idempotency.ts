import type { Prisma, PrismaClient } from '@prisma/client';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyStore {
  findRecord: (key: string) => Promise<{ response: Prisma.JsonValue; createdAt: Date } | null>;
  saveRecord: (key: string, response: Prisma.InputJsonValue) => Promise<void>;
}

export const buildIdempotencyStore = (prisma: PrismaClient): IdempotencyStore => ({
  findRecord: (key) => prisma.idempotencyRecord.findUnique({ where: { key } }),
  saveRecord: async (key, response) => {
    await prisma.idempotencyRecord.upsert({
      where: { key },
      create: { key, response },
      update: { response, createdAt: new Date() },
    });
  },
});

export type WithIdempotency = <T extends Prisma.InputJsonValue>(
  key: string,
  fn: () => Promise<T>,
) => Promise<T>;

// Registros con más de 24h se tratan como expirados (se ignora el valor
// cacheado y se vuelve a ejecutar fn, sobrescribiendo el registro). La
// limpieza física de records vencidos es un cron aparte (ver SPEC.md 5.4),
// fuera del alcance de este helper.
export const buildWithIdempotency = (store: IdempotencyStore): WithIdempotency => {
  return async <T extends Prisma.InputJsonValue>(key: string, fn: () => Promise<T>): Promise<T> => {
    const existing = await store.findRecord(key);

    if (existing && Date.now() - existing.createdAt.getTime() < IDEMPOTENCY_TTL_MS) {
      return existing.response as T;
    }

    const response = await fn();
    await store.saveRecord(key, response);
    return response;
  };
};
