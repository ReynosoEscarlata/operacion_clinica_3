// Catálogo cerrado de acciones/recursos auditables (Fase 5, ADR-013). Una
// acción fuera de esta lista es error de compilación en writeAuditLog() de
// cada servicio -- evita que un llamado nuevo se agregue con un string
// suelto y quede fuera del inventario de qué se audita.
export const AUDIT_ACTIONS = [
  'user.login',
  'user.token_refreshed',
  'user.created',
  'user.updated',
  'patient.created',
  'patient.read',
  'patient.updated',
  'doctor.created',
  'doctor.updated',
  'appointment.status_changed',
  'payment.webhook_processed',
  'support_access.granted',
  'dead_letter.read',
  'dead_letter.retried',
  'dead_letter.removed',
  'arco.access_requested',
  'arco.cancellation_requested',
  'arco.opposition_requested',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESOURCE_TYPES = [
  'user',
  'patient',
  'doctor',
  'appointment',
  'payment',
  'support_access_grant',
  'dead_letter_entry',
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export const AUDIT_RESULTS = ['success', 'failure'] as const;

export type AuditResult = (typeof AUDIT_RESULTS)[number];
