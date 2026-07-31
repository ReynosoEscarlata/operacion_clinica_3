// Headers internos que el gateway reenvía a los servicios de "atrás"
// (límite de confianza de red interna, RFC-004 sección "Autorización
// servicio-a-servicio"). Antes de este paquete, cada servicio definía
// TENANT_ID_HEADER por su cuenta en lib/constants.ts -- fuente única ahora.
export const TENANT_ID_HEADER = 'x-internal-tenant-id' as const;
export const USER_ROLE_HEADER = 'x-internal-user-role' as const;
export const DOCTOR_ID_HEADER = 'x-internal-doctor-id' as const;
// Claim `sub` del JWT (id de User) -- necesario para auditoría que requiera
// saber QUIÉN actuó, no solo con qué rol (ej. SupportAccessGrant.actorId).
export const USER_ID_HEADER = 'x-internal-user-id' as const;
// Presente solo cuando el request opera bajo un JWT de elevación emitido por
// POST /v1/auth/support-access (escalada de platform_support, RFC-004).
export const SUPPORT_GRANT_ID_HEADER = 'x-internal-support-grant-id' as const;
