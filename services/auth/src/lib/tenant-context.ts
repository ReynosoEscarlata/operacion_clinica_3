import { AsyncLocalStorage } from 'node:async_hooks';

// Mismo molde que request-context.ts (requestId), aplicado a tenant_id.
// tenantId es `null` únicamente para roles de plataforma (platform_admin/
// platform_support, RFC-004) — no se construyen en esta fase, pero el
// esquema y este contexto ya los soportan (RFC-003).
export interface TenantContext {
  tenantId: string | null;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export const getTenantId = (): string | null | undefined =>
  tenantContextStorage.getStore()?.tenantId;
