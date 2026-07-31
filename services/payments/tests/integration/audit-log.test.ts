import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { writeAuditLog } from '../../src/lib/audit-log.js';
import { withTenant } from '../../src/lib/tenant-scoped.js';
import { runWithTenant } from '../../src/lib/tenant-context.js';
import { TENANT_A, TENANT_B } from '../helpers/tenancy.js';

describe('AuditLog (integración con DB real, Fase 5 / ADR-013)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writeAuditLog() escribe una fila con los campos obligatorios', async () => {
    const resourceId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => writeAuditLog(tx, 'payment.webhook_processed', 'payment', resourceId, 'success')),
    );

    const [row] = await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => tx.auditLog.findMany({ where: { resourceId } })),
    );

    expect(row).toBeDefined();
    expect(row?.action).toBe('payment.webhook_processed');
    expect(row?.resourceType).toBe('payment');
    expect(row?.tenantId).toBe(TENANT_A);
    expect(row?.result).toBe('success');
  });

  it('un actor de un tenant no ve las filas de audit log de otro tenant', async () => {
    const resourceId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => writeAuditLog(tx, 'payment.webhook_processed', 'payment', resourceId, 'failure')),
    );

    const rowsFromOtherTenant = await runWithTenant(TENANT_B, () =>
      withTenant(prisma, (tx) => tx.auditLog.findMany({ where: { resourceId } })),
    );

    expect(rowsFromOtherTenant).toHaveLength(0);
  });

  it('app_role no puede UPDATE una fila de AuditLog (permission denied)', async () => {
    const resourceId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => writeAuditLog(tx, 'payment.webhook_processed', 'payment', resourceId, 'success')),
    );

    await expect(
      runWithTenant(TENANT_A, () =>
        withTenant(
          prisma,
          (tx) => tx.$executeRaw`UPDATE "AuditLog" SET result = 'failure' WHERE "resourceId" = ${resourceId}`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('app_role no puede DELETE una fila de AuditLog (permission denied)', async () => {
    const resourceId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => writeAuditLog(tx, 'payment.webhook_processed', 'payment', resourceId, 'success')),
    );

    await expect(
      runWithTenant(TENANT_A, () =>
        withTenant(prisma, (tx) => tx.$executeRaw`DELETE FROM "AuditLog" WHERE "resourceId" = ${resourceId}`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
