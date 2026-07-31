import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { writeAuditLog } from '../../src/lib/audit-log.js';
import { withTenant } from '../../src/lib/tenant-scoped.js';
import { tenantContextStorage } from '../../src/lib/tenant-context.js';
import { TENANT_A, TENANT_B } from '../helpers/tenancy.js';

// Doctors no tiene runWithTenant() (a diferencia de Appointments/Auth) --
// las rutas públicas leen cross-tenant directo, sin necesidad de "entrar"
// a un tenant dinámicamente. Se usa tenantContextStorage.run() directo,
// mismo storage que puebla el middleware real.
const runWithTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  tenantContextStorage.run({ tenantId }, fn);

describe('AuditLog (integración con DB real, Fase 5 / ADR-013)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writeAuditLog() escribe una fila con los campos obligatorios', async () => {
    const resourceId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => writeAuditLog(tx, 'doctor.created', 'doctor', resourceId, 'success')),
    );

    const [row] = await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => tx.auditLog.findMany({ where: { resourceId } })),
    );

    expect(row).toBeDefined();
    expect(row?.action).toBe('doctor.created');
    expect(row?.resourceType).toBe('doctor');
    expect(row?.tenantId).toBe(TENANT_A);
    expect(row?.result).toBe('success');
  });

  it('un actor de un tenant no ve las filas de audit log de otro tenant', async () => {
    const resourceId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => writeAuditLog(tx, 'doctor.created', 'doctor', resourceId, 'success')),
    );

    const rowsFromOtherTenant = await runWithTenant(TENANT_B, () =>
      withTenant(prisma, (tx) => tx.auditLog.findMany({ where: { resourceId } })),
    );

    expect(rowsFromOtherTenant).toHaveLength(0);
  });

  it('app_role no puede UPDATE una fila de AuditLog (permission denied)', async () => {
    const resourceId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      withTenant(prisma, (tx) => writeAuditLog(tx, 'doctor.created', 'doctor', resourceId, 'success')),
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
      withTenant(prisma, (tx) => writeAuditLog(tx, 'doctor.created', 'doctor', resourceId, 'success')),
    );

    await expect(
      runWithTenant(TENANT_A, () =>
        withTenant(prisma, (tx) => tx.$executeRaw`DELETE FROM "AuditLog" WHERE "resourceId" = ${resourceId}`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
