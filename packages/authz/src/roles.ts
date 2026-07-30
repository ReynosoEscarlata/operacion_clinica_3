// RFC-004-rbac.md: dos planos de autorización. Plataforma = acceso
// cross-tenant, auditado. Tenant = acotado a los datos de la propia clínica
// (RFC-003).
export const PLATFORM_ROLES = ['platform_admin', 'platform_support'] as const;
export const TENANT_ROLES = ['clinic_owner', 'clinic_admin', 'doctor', 'receptionist', 'patient'] as const;
export const ROLES = [...PLATFORM_ROLES, ...TENANT_ROLES] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type TenantRole = (typeof TENANT_ROLES)[number];
export type Role = (typeof ROLES)[number];

// `patient` nunca aparece en un JWT real (RFC-001: el paciente no tiene
// cuenta, se identifica por posesión del UUID de su cita) -- se incluye en
// Role solo para que PERMISSION_MATRIX sea transcribible 1:1 desde la tabla
// de RFC-004 (que sí tiene una columna `patient`) y para poder testear esas
// celdas. AuthActor.role usa este subtipo, que es el único que un actor
// autenticado puede tener.
export type AuthenticatedRole = Exclude<Role, 'patient'>;
