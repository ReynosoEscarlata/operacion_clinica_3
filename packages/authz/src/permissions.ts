// Catálogo `recurso:acción` derivado de los endpoints reales del repo
// (docs/rfc/RFC-004-rbac.md, sección "Catálogo de permisos"). 28 permisos.
export const PERMISSIONS = [
  'auth:login',
  'auth:refresh',
  'user:create',
  'user:list',
  'user:deactivate',
  'doctor:create',
  'doctor:list',
  'doctor:read',
  'doctor:read_slots',
  'doctor:manage_availability',
  'patient:create',
  'patient:read',
  'patient:list',
  'patient:update',
  'appointment:create',
  'appointment:read',
  'appointment:list',
  'appointment:cancel',
  'appointment:complete',
  'appointment:mark_no_show',
  'dashboard:read',
  'audit:read',
  'dead_letter:read',
  'dead_letter:retry',
  'dead_letter:remove',
  'payment:create_customer',
  'payment:create_intent',
  'payment:cancel_intent',
  'payment:refund',
  // Fase 6 (ADR-017): GET /v1/platform/dashboard, /v1/platform/metrics
  // (Appointments) y /v1/platform-users/active (Auth) -- exclusivo del
  // plano de plataforma (RFC-004), nunca un rol de tenant.
  'platform_dashboard:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
