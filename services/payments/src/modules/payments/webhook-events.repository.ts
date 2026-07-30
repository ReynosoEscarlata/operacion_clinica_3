import type { Prisma, PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';

import { withTenantId } from '../../lib/tenant-scoped.js';

const WEBHOOK_UNIQUE_CONSTRAINT_CODE = 'P2002';

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === WEBHOOK_UNIQUE_CONSTRAINT_CODE;

export interface WebhookEventsRepository {
  claim: (event: Stripe.Event, tenantId: string | null) => Promise<boolean>;
  markProcessed: (stripeEventId: string, tenantId: string | null) => Promise<void>;
}

export class PrismaWebhookEventsRepository implements WebhookEventsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(event: Stripe.Event, tenantId: string | null): Promise<boolean> {
    try {
      await withTenantId(this.prisma, tenantId, (tx) =>
        tx.webhookEvent.create({
          data: {
            // Se omite la clave por completo (en vez de pasar `null`
            // explícito) cuando no hay tenant resuelto: Prisma 5.22 con un
            // campo `@db.Uuid` opcional serializa un `null` explícito como
            // cadena vacía en el protocolo nativo, lo que Postgres rechaza
            // (invalid input syntax for type uuid: ""). Omitir la clave deja
            // que la columna tome su default NULL normalmente.
            ...(tenantId ? { tenantId } : {}),
            stripeEventId: event.id,
            type: event.type,
            payload: event as unknown as Prisma.InputJsonObject,
            processedAt: null,
          },
        }),
      );
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async markProcessed(stripeEventId: string, tenantId: string | null): Promise<void> {
    await withTenantId(this.prisma, tenantId, (tx) =>
      tx.webhookEvent.update({
        where: { stripeEventId },
        data: { processedAt: new Date() },
      }),
    );
  }
}

export const buildWebhookEventsRepository = (prisma: PrismaClient): WebhookEventsRepository =>
  new PrismaWebhookEventsRepository(prisma);
