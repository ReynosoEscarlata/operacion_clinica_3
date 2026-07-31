import { logCrossTenantAccessDenied } from '@clinica/observability';

import { getAuthActor } from './authz-context.js';
import type { Logger } from './logger.js';
import { getRequestId, getTraceId } from './request-context.js';

// Amenaza #3 del threat model (IDOR por posesión de UUID): un actor con
// tenant ambiental pide un recurso que no aparece en su propio scope
// (RLS ya filtró la fila). Antes de responder el mismo 404 de siempre --
// la respuesta NUNCA cambia, cambiarla filtraría existencia -- se resuelve
// el tenant REAL de ese id vía la función SECURITY DEFINER (bypassa RLS) y
// se compara contra el tenant ambiental. Si no coincide, es un acceso
// cross-tenant confirmado: se audita en paralelo a la respuesta 404, nunca
// en lugar de ella.
export const auditCrossTenantMismatch = async (
  logger: Logger,
  resource: 'appointment' | 'patient',
  resourceId: string,
  ambientTenantId: string,
  resolveTrueTenantId: () => Promise<string | null>,
): Promise<void> => {
  const resourceTenantId = await resolveTrueTenantId();
  if (!resourceTenantId || resourceTenantId === ambientTenantId) {
    return;
  }

  const actor = getAuthActor();
  logCrossTenantAccessDenied(logger, {
    service: 'appointments',
    resource,
    resourceId,
    actorTenantId: ambientTenantId,
    resourceTenantId,
    actorRole: actor?.role ?? 'desconocido',
    actorSub: actor?.sub ?? null,
    requestId: getRequestId(),
    traceId: getTraceId(),
  });
};
