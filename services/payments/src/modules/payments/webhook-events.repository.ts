import type { Prisma, PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';

const WEBHOOK_UNIQUE_CONSTRAINT_CODE = 'P2002';

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === WEBHOOK_UNIQUE_CONSTRAINT_CODE;

export interface WebhookEventsRepository {
  claim: (event: Stripe.Event) => Promise<boolean>;
  markProcessed: (stripeEventId: string) => Promise<void>;
}

export class PrismaWebhookEventsRepository implements WebhookEventsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(event: Stripe.Event): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          stripeEventId: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonObject,
          processedAt: null,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async markProcessed(stripeEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { stripeEventId },
      data: { processedAt: new Date() },
    });
  }
}

export const buildWebhookEventsRepository = (prisma: PrismaClient): WebhookEventsRepository =>
  new PrismaWebhookEventsRepository(prisma);
