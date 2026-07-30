import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';
import { TENANT_A, TENANT_B } from '../helpers/tenancy.js';

// Aislamiento cross-tenant a nivel de base de datos (Fase 3a): Payments no
// tiene ningún endpoint HTTP que lea datos propios filtrados por tenant
// (ver route-coverage.meta.test.ts), así que lo que hay que verificar aquí
// es que RLS aísla de verdad a nivel de motor, con dos tenants reales.
describe('Aislamiento cross-tenant (DB): WebhookEvent/OutboxEvent', () => {
  const createdWebhookEventIds: string[] = [];
  const createdOutboxEventIds: string[] = [];

  afterAll(async () => {
    await withTenantId(prisma, TENANT_A, (tx) =>
      tx.webhookEvent.deleteMany({ where: { id: { in: createdWebhookEventIds } } }),
    ).catch(() => undefined);
    await withTenantId(prisma, TENANT_B, (tx) =>
      tx.webhookEvent.deleteMany({ where: { id: { in: createdWebhookEventIds } } }),
    ).catch(() => undefined);
    await withTenantId(prisma, TENANT_A, (tx) =>
      tx.outboxEvent.deleteMany({ where: { id: { in: createdOutboxEventIds } } }),
    ).catch(() => undefined);
    await withTenantId(prisma, TENANT_B, (tx) =>
      tx.outboxEvent.deleteMany({ where: { id: { in: createdOutboxEventIds } } }),
    ).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('con app.current_tenant = A, un SELECT * sin WHERE sobre OutboxEvent nunca devuelve filas de B', async () => {
    const eventA = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.outboxEvent.create({ data: { tenantId: TENANT_A, type: 'PaymentSucceeded', payload: {} } }),
    );
    const eventB = await withTenantId(prisma, TENANT_B, (tx) =>
      tx.outboxEvent.create({ data: { tenantId: TENANT_B, type: 'PaymentSucceeded', payload: {} } }),
    );
    createdOutboxEventIds.push(eventA.id, eventB.id);

    const rows = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.$queryRaw<Array<{ id: string; tenantId: string }>>`SELECT id, "tenantId" FROM "OutboxEvent"`,
    );

    expect(rows.some((row) => row.id === eventA.id)).toBe(true);
    expect(rows.some((row) => row.id === eventB.id)).toBe(false);
    expect(rows.every((row) => row.tenantId === TENANT_A)).toBe(true);
  });

  it('sin app.current_tenant seteado, app_role no ve ninguna fila de OutboxEvent', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "OutboxEvent"`;
    expect(Number(rows[0]?.count ?? -1)).toBe(0);
  });

  it('WebhookEvent con tenantId NULL (evento sin tenant resoluble) es visible desde cualquier tenant, pero uno con tenant real no cruza', async () => {
    const nullTenantEvent = await withTenantId(prisma, TENANT_A, (tx) =>
      // tenantId omitido a propósito (nullable) -- ver
      // webhook-events.repository.ts para la explicación del mismo patrón.
      tx.webhookEvent.create({
        data: { stripeEventId: `evt_iso_${randomUUID()}`, type: 'charge.refunded', payload: {} },
      }),
    );
    const tenantAEvent = await withTenantId(prisma, TENANT_A, (tx) =>
      tx.webhookEvent.create({
        data: {
          tenantId: TENANT_A,
          stripeEventId: `evt_iso_${randomUUID()}`,
          type: 'payment_intent.succeeded',
          payload: {},
        },
      }),
    );
    createdWebhookEventIds.push(nullTenantEvent.id, tenantAEvent.id);

    const rowsFromB = await withTenantId(prisma, TENANT_B, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WebhookEvent"`,
    );

    expect(rowsFromB.some((row) => row.id === nullTenantEvent.id)).toBe(true);
    expect(rowsFromB.some((row) => row.id === tenantAEvent.id)).toBe(false);
  });
});
