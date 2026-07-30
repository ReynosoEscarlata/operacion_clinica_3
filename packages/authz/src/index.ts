export type { AuthActor } from './actor.js';
export { can, isOwnScoped } from './can.js';
export {
  DOCTOR_ID_HEADER,
  SUPPORT_GRANT_ID_HEADER,
  TENANT_ID_HEADER,
  USER_ROLE_HEADER,
} from './headers.js';
export type { PermissionGrant, PermissionMatrix } from './matrix.js';
export { PERMISSION_MATRIX } from './matrix.js';
export type { Permission } from './permissions.js';
export { PERMISSIONS } from './permissions.js';
export { registerAuthzEnforcement, requirePermission } from './require-permission.js';
export type { AuthenticatedRole, PlatformRole, Role, TenantRole } from './roles.js';
export { PLATFORM_ROLES, ROLES, TENANT_ROLES } from './roles.js';
