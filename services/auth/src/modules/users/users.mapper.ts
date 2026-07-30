import type { UserRole } from '@prisma/client';
import type { AuthenticatedRole } from '@clinica/authz';

// El enum de Prisma usa MAYÚSCULAS (convención ya establecida en el repo,
// ADMIN/STAFF antes de esta fase); los roles que viajan por JWT, headers
// internos, `app.actor_role` y `@clinica/authz` usan snake_case en
// minúscula (así están ya escritas las políticas RLS y RFC-004-rbac.md).
// Un solo mapeo explícito en vez de forzar que ambos mundos compartan
// casing.
const ROLE_TO_AUTHZ: Record<UserRole, AuthenticatedRole> = {
  PLATFORM_ADMIN: 'platform_admin',
  PLATFORM_SUPPORT: 'platform_support',
  CLINIC_OWNER: 'clinic_owner',
  CLINIC_ADMIN: 'clinic_admin',
  DOCTOR: 'doctor',
  RECEPTIONIST: 'receptionist',
};

export const toAuthzRole = (role: UserRole): AuthenticatedRole => ROLE_TO_AUTHZ[role];
