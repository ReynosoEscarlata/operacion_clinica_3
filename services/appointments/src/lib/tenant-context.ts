import { AsyncLocalStorage } from 'node:async_hooks';

// Mismo molde que request-context.ts (requestId), aplicado a tenant_id.
export interface TenantContext {
  tenantId: string | null;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export const getTenantId = (): string | null | undefined =>
  tenantContextStorage.getStore()?.tenantId;

// Para los flujos públicos (paciente sin cuenta) donde el tenant se resuelve
// DENTRO del propio request a partir de un doctorId o de un
// resolve_tenant_for_X(id) -- no viene del middleware (que ahí entra con
// tenantId: null, ver middleware/tenant-context.ts). El resto del código
// (servicios, repositorios) sigue usando getTenantId()/withTenant() de
// forma uniforme sin saber si el tenant vino de un header o de aquí.
export const runWithTenant = <T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> =>
  tenantContextStorage.run({ tenantId }, fn);
