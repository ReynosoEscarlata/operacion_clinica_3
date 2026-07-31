import type { Prisma } from '@prisma/client';
import type { AuditAction, AuditResourceType, AuditResult } from '@clinica/audit-log';

import { getAuthActor } from './authz-context.js';
import { getRequestContext } from './request-context.js';
import { getTenantId } from './tenant-context.js';

// Molde exacto de writeOutboxEvent (outbox.ts): recibe un
// Prisma.TransactionClient ya abierto para que un fallo del insert revierta
// también la operación de negocio (Fase 5, "si el audit log falla, la
// operación falla" -- sin try/catch que lo trague, se deja propagar).
//
// `actor` es un override explícito para los flujos donde todavía no hay
// contexto ambiental (login/refresh: el actor recién se determina DENTRO
// del propio método, no viene de authz-context.ts porque el request llega
// sin autenticar). Cuando se omite, se usan authz-context.ts/tenant-context.ts
// ambientales -- el caso común de cualquier mutación/lectura ya autenticada.
export interface AuditActorOverride {
  tenantId: string | null;
  actorId: string | null;
  actorRole: string | null;
}

export const writeAuditLog = async (
  tx: Prisma.TransactionClient,
  action: AuditAction,
  resourceType: AuditResourceType,
  resourceId: string | null,
  result: AuditResult,
  options?: { justification?: string; actor?: AuditActorOverride },
): Promise<void> => {
  const requestContext = getRequestContext();
  const ambientActor = getAuthActor();

  const actor = options?.actor ?? {
    tenantId: getTenantId() ?? null,
    actorId: ambientActor?.sub ?? null,
    actorRole: ambientActor?.role ?? null,
  };

  await tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action,
      resourceType,
      resourceId,
      ip: requestContext?.ip ?? null,
      userAgent: requestContext?.userAgent ?? null,
      correlationId: requestContext?.requestId ?? null,
      result,
      justification: options?.justification ?? null,
    },
  });
};
