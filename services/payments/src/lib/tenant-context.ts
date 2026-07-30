import { AsyncLocalStorage } from 'node:async_hooks';

// Mismo molde que request-context.ts (requestId) y que los demás
// servicios, aplicado a tenant_id. A diferencia de Auth/Doctors/
// Appointments, aquí SIEMPRE se entra en el contexto (nunca 401 por falta
// de header, ver middleware/tenant-context.ts) -- el tenant es opcional en
// este servicio.
export interface TenantContext {
  tenantId: string | null;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export const getTenantId = (): string | null | undefined =>
  tenantContextStorage.getStore()?.tenantId;

// Usado por webhook.service.ts: el tenant se resuelve DENTRO del propio
// procesamiento del evento (desde el metadata del PaymentIntent), no viene
// de ningún header -- Stripe llama a este servicio directamente, sin JWT ni
// contexto previo.
export const runWithTenant = <T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> =>
  tenantContextStorage.run({ tenantId }, fn);
