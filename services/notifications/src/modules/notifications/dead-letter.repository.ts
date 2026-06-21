import type { DeadLetterEntry, Prisma, PrismaClient } from '@prisma/client';

export interface DeadLetterRepository {
  list: () => Promise<DeadLetterEntry[]>;
  findById: (id: string) => Promise<DeadLetterEntry | null>;
  remove: (id: string) => Promise<void>;
  record: (
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    error: string,
    attempts: number,
  ) => Promise<void>;
}

export const buildDeadLetterRepository = (prisma: PrismaClient): DeadLetterRepository => ({
  list: () => prisma.deadLetterEntry.findMany({ orderBy: { failedAt: 'desc' }, take: 200 }),
  findById: (id) => prisma.deadLetterEntry.findUnique({ where: { id } }),
  remove: async (id) => {
    await prisma.deadLetterEntry.delete({ where: { id } });
  },
  record: async (eventId, eventType, payload, error, attempts) => {
    await prisma.deadLetterEntry.create({
      data: { eventId, eventType, payload: payload as Prisma.InputJsonValue, error, attempts },
    });
  },
});
