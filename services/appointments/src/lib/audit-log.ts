import type { Prisma } from '@prisma/client';
import type { AuditAction, AuditResourceType, AuditResult } from '@clinica/audit-log';

import { getAuthActor } from './authz-context.js';
import { getRequestContext } from './request-context.js';
import { getTenantId } from './tenant-context.js';

// Molde exacto de writeOutboxEvent (outbox.ts): recibe un
// Prisma.TransactionClient ya abierto para que un fallo del insert revierta
// también la operación de negocio (Fase 5, "si el audit log falla, la
// operación falla"). A diferencia de Auth, acá no hace falta un override de
// actor explícito -- toda ruta de este servicio (pública por posesión de
// UUID incluida) ya entra en runWithTenant()/TenantContext ambiental antes
// de llegar a cualquier repositorio o a state-machine.ts, así que
// getTenantId()/getAuthActor() siempre están poblados en este punto.
export const writeAuditLog = async (
  tx: Prisma.TransactionClient,
  action: AuditAction,
  resourceType: AuditResourceType,
  resourceId: string | null,
  result: AuditResult,
  justification?: string,
): Promise<void> => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error('writeAuditLog() llamado sin tenant en contexto');
  }

  const actor = getAuthActor();
  const requestContext = getRequestContext();

  await tx.auditLog.create({
    data: {
      tenantId,
      actorId: actor?.sub ?? null,
      actorRole: actor?.role ?? null,
      action,
      resourceType,
      resourceId,
      ip: requestContext?.ip ?? null,
      userAgent: requestContext?.userAgent ?? null,
      correlationId: requestContext?.requestId ?? null,
      result,
      justification: justification ?? null,
    },
  });
};
