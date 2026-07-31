import type { Logger } from './logger.js';

// Forma canónica de las líneas de seguridad -- un CloudWatch Logs Metric
// Filter matchea un shape exacto (`$.event = '...'`), así que este shape
// tiene que salir de un solo lugar y ser byte-idéntico en los 6 procesos
// (ADR-017). Nunca la fila completa del recurso, nunca PII: solo IDs
// opacos (UUID) y metadatos de actor/recurso -- exactamente lo que un
// runbook de investigación necesita, nada más.
export type SecurityEventType = 'cross_tenant_access_denied' | 'authz_denied';
export type SecurityEventSeverity = 'critical' | 'warn';

interface BaseSecurityEvent {
  securityEvent: true;
  severity: SecurityEventSeverity;
  service: string;
  // `| undefined` explícito -- mismo motivo que en emf.ts/xray-plugin.ts:
  // exactOptionalPropertyTypes exige que el tipo declarado incluya
  // `undefined` cuando el caller pasa el resultado directo de
  // getRequestId()/getTraceId() en vez de omitir la clave.
  requestId?: string | undefined;
  traceId?: string | undefined;
}

// Amenaza #3 del threat model (IDOR por posesión de UUID): un tenant
// resuelve un recurso ajeno vía `resolve_tenant_for_X` (SECURITY DEFINER) y
// el resultado no coincide con el tenant ambiental. La respuesta HTTP sigue
// siendo 404 -- cambiarla filtraría existencia -- esto es solo el registro
// de seguridad en paralelo a esa respuesta, nunca en lugar de ella.
export interface CrossTenantAccessDeniedEvent extends BaseSecurityEvent {
  event: 'cross_tenant_access_denied';
  severity: 'critical';
  resource: string;
  resourceId: string;
  actorTenantId: string | null;
  resourceTenantId: string;
  actorRole: string;
  actorSub: string | null;
}

export interface AuthzDeniedEvent extends BaseSecurityEvent {
  event: 'authz_denied';
  severity: 'warn';
  permission: string;
  actorRole: string;
  actorSub: string | null;
  actorTenantId: string | null;
}

export const logCrossTenantAccessDenied = (
  logger: Logger,
  input: Omit<CrossTenantAccessDeniedEvent, 'securityEvent' | 'severity' | 'event'>,
): void => {
  const event: CrossTenantAccessDeniedEvent = {
    event: 'cross_tenant_access_denied',
    securityEvent: true,
    severity: 'critical',
    ...input,
  };
  logger.error(event, 'Acceso cross-tenant detectado -- ver docs/runbooks/alarma-acceso-cross-tenant.md');
};

export const logAuthzDenied = (
  logger: Logger,
  input: Omit<AuthzDeniedEvent, 'securityEvent' | 'severity' | 'event'>,
): void => {
  const event: AuthzDeniedEvent = {
    event: 'authz_denied',
    securityEvent: true,
    severity: 'warn',
    ...input,
  };
  logger.warn(event, 'Denegación de autorización');
};
