import type { DeadLetterEntry, Prisma, PrismaClient } from '@prisma/client';

export interface DeadLetterRepository {
  record: (
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    error: string,
    attempts: number,
  ) => Promise<void>;
  list: () => Promise<DeadLetterEntry[]>;
  findById: (id: string) => Promise<DeadLetterEntry | null>;
  remove: (id: string) => Promise<void>;
}

const MAX_LIST_RESULTS = 200;

export const buildDeadLetterRepository = (prisma: PrismaClient): DeadLetterRepository => ({
  record: async (eventId, eventType, payload, error, attempts) => {
    await prisma.deadLetterEntry.create({
      data: { eventId, eventType, payload: payload as Prisma.InputJsonValue, error, attempts },
    });
  },

  list: async () => prisma.deadLetterEntry.findMany({ orderBy: { failedAt: 'desc' }, take: MAX_LIST_RESULTS }),

  findById: async (id) => prisma.deadLetterEntry.findUnique({ where: { id } }),

  remove: async (id) => {
    await prisma.deadLetterEntry.delete({ where: { id } });
  },
});
