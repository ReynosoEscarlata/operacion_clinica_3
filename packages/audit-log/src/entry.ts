import type { AuditAction, AuditResourceType, AuditResult } from './actions.js';

// Los 12 campos obligatorios del plan maestro (Fase 5) para un registro de
// audit log inmutable. `timestamp` no viaja acá -- lo pone Prisma vía
// `@default(now())` en cada tabla AuditLog, no el llamador.
export interface AuditLogEntry {
  tenantId: string | null;
  actorId: string | null;
  actorRole: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  result: AuditResult;
  justification: string | null;
}
