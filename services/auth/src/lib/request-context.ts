import { AsyncLocalStorage } from 'node:async_hooks';

// ip/userAgent (Fase 5, ADR-013): dos de los 12 campos obligatorios de
// AuditLog -- se capturan acá porque request-id.ts ya es el único hook que
// puebla este storage por request, no hace falta un middleware nuevo.
export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string | null;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined => requestContextStorage.getStore()?.requestId;

export const getRequestContext = (): RequestContext | undefined => requestContextStorage.getStore();
