import { AsyncLocalStorage } from 'node:async_hooks';

// Mismo molde que request-context.ts (requestId), aplicado a tenant_id.
export interface TenantContext {
  tenantId: string | null;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export const getTenantId = (): string | null | undefined =>
  tenantContextStorage.getStore()?.tenantId;
