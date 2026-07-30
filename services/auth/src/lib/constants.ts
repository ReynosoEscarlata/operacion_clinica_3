export const REQUEST_ID_HEADER = 'x-request-id' as const;

// Poblado únicamente por el gateway a partir del claim `tenant_id` de un JWT
// ya verificado (RFC-003-tenancy.md) — NUNCA se lee de un header que pudiera
// venir directo de un cliente sin pasar por el gateway.
export const TENANT_ID_HEADER = 'x-internal-tenant-id' as const;
