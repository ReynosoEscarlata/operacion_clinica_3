import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { writeAuditLog } from '../../src/lib/audit-log.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';

const TENANT_A = 'c0000000-c000-c000-c000-c00000000001';
const TENANT_B = 'c0000000-c000-c000-c000-c00000000002';
const ACTOR_ID = randomUUID();

describe('AuditLog (integración con DB real, Fase 5 / ADR-013)', () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    // Limpieza vía el rol dueño de la tabla (no app_role -- app_role no
    // tiene DELETE, ver el propio test de abajo). No hay acceso a ese rol
    // desde el cliente de la app, así que las filas de prueba quedan; en un
    // entorno de test descartable esto es aceptable (mismo criterio que el
    // resto de la suite, que reusa una base de test efímera).
    void createdIds;
    await prisma.$disconnect();
  });

  it('writeAuditLog() escribe una fila con los campos obligatorios', async () => {
    const resourceId = randomUUID();
    await withTenantId(
      prisma,
      TENANT_A,
      (tx) =>
        writeAuditLog(tx, 'patient.read', 'patient', resourceId, 'success', {
          actor: { tenantId: TENANT_A, actorId: ACTOR_ID, actorRole: 'clinic_owner' },
        }),
      'clinic_owner',
    );

    const [row] = await withTenantId(
      prisma,
      TENANT_A,
      (tx) => tx.auditLog.findMany({ where: { resourceId } }),
      'clinic_owner',
    );

    expect(row).toBeDefined();
    expect(row?.action).toBe('patient.read');
    expect(row?.resourceType).toBe('patient');
    expect(row?.tenantId).toBe(TENANT_A);
    expect(row?.actorId).toBe(ACTOR_ID);
    expect(row?.result).toBe('success');
    createdIds.push(row?.id ?? '');
  });

  it('un actor de un tenant no ve las filas de audit log de otro tenant', async () => {
    const resourceId = randomUUID();
    await withTenantId(
      prisma,
      TENANT_A,
      (tx) =>
        writeAuditLog(tx, 'patient.read', 'patient', resourceId, 'success', {
          actor: { tenantId: TENANT_A, actorId: ACTOR_ID, actorRole: 'clinic_owner' },
        }),
      'clinic_owner',
    );

    const rowsFromOtherTenant = await withTenantId(
      prisma,
      TENANT_B,
      (tx) => tx.auditLog.findMany({ where: { resourceId } }),
      'clinic_owner',
    );

    expect(rowsFromOtherTenant).toHaveLength(0);
  });

  it('un actor de plataforma ve filas de cualquier tenant', async () => {
    const resourceId = randomUUID();
    await withTenantId(
      prisma,
      TENANT_A,
      (tx) =>
        writeAuditLog(tx, 'patient.read', 'patient', resourceId, 'success', {
          actor: { tenantId: TENANT_A, actorId: ACTOR_ID, actorRole: 'clinic_owner' },
        }),
      'clinic_owner',
    );

    const rows = await withTenantId(
      prisma,
      null,
      (tx) => tx.auditLog.findMany({ where: { resourceId } }),
      'platform_admin',
    );

    expect(rows).toHaveLength(1);
  });

  // ADR-013: la garantía de inmutabilidad depende enteramente de que
  // app_role no pueda UPDATE/DELETE -- sin esto verificado, la tabla podría
  // parecer append-only por convención de la app y no serlo a nivel de
  // motor (exactamente el bug que este mismo commit corrigió en
  // SupportAccessGrant, ver 20260731020000_fix_support_access_grant_privileges).
  it('app_role no puede UPDATE una fila de AuditLog (permission denied)', async () => {
    const resourceId = randomUUID();
    await withTenantId(
      prisma,
      TENANT_A,
      (tx) =>
        writeAuditLog(tx, 'patient.read', 'patient', resourceId, 'success', {
          actor: { tenantId: TENANT_A, actorId: ACTOR_ID, actorRole: 'clinic_owner' },
        }),
      'clinic_owner',
    );

    await expect(
      withTenantId(
        prisma,
        TENANT_A,
        (tx) => tx.$executeRaw`UPDATE "AuditLog" SET result = 'failure' WHERE "resourceId" = ${resourceId}`,
        'clinic_owner',
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('app_role no puede DELETE una fila de AuditLog (permission denied)', async () => {
    const resourceId = randomUUID();
    await withTenantId(
      prisma,
      TENANT_A,
      (tx) =>
        writeAuditLog(tx, 'patient.read', 'patient', resourceId, 'success', {
          actor: { tenantId: TENANT_A, actorId: ACTOR_ID, actorRole: 'clinic_owner' },
        }),
      'clinic_owner',
    );

    await expect(
      withTenantId(
        prisma,
        TENANT_A,
        (tx) => tx.$executeRaw`DELETE FROM "AuditLog" WHERE "resourceId" = ${resourceId}`,
        'clinic_owner',
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
