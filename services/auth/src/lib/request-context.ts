import { AsyncLocalStorage } from 'node:async_hooks';

// ip/userAgent (Fase 5, ADR-013): dos de los 12 campos obligatorios de
// AuditLog -- se capturan acá porque request-id.ts ya es el único hook que
// puebla este storage por request, no hace falta un middleware nuevo.
export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string | null;
  // Poblado por el plugin de X-Ray (Fase 6, ADR-017) DESPUÉS de que este
  // storage ya fue entrado por request-id.ts -- por eso es mutable acá en
  // vez de venir en el objeto inicial, mismo patrón que setTenantId en el
  // gateway.
  traceId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined => requestContextStorage.getStore()?.requestId;

export const getRequestContext = (): RequestContext | undefined => requestContextStorage.getStore();

export const getTraceId = (): string | undefined => requestContextStorage.getStore()?.traceId;

export const setTraceId = (traceId: string): void => {
  const store = requestContextStorage.getStore();
  if (store) store.traceId = traceId;
};
