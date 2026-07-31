import { AsyncLocalStorage } from 'node:async_hooks';

// Mismo molde que request-context.ts (requestId), aplicado a tenant_id.
export interface TenantContext {
  tenantId: string | null;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export const getTenantId = (): string | null | undefined =>
  tenantContextStorage.getStore()?.tenantId;

// El consumer de eventos de dominio corre en background, sin ningún
// TenantContext de request -- cada handler entra explícitamente en el
// tenant del envelope (event.tenantId, garantizado no-null por
// domainEventEnvelopeSchema) antes de tocar cualquier repositorio.
export const runWithTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  tenantContextStorage.run({ tenantId }, fn);
