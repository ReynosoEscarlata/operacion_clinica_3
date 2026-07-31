import { AsyncLocalStorage } from 'node:async_hooks';

// Mismo molde que services/*/src/lib/request-context.ts -- el gateway
// nunca tuvo uno (Fase 6, ADR-017, cierra docs/backlog-deuda.md ítem 8).
// tenantId se puebla en verify-jwt.ts (después de verificar el JWT, no
// antes) -- null para roles de plataforma o requests sin JWT válido, nunca
// leído de un header que pudiera venir directo de un cliente.
export interface RequestContext {
  requestId: string;
  tenantId?: string | null;
  // Poblado por el plugin de X-Ray (Fase 6, ADR-017), igual que tenantId:
  // el store ya existe (entrado por request-id.ts), así que se mutan ambos
  // campos en el lugar en vez de volver a entrar el contexto.
  traceId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined => requestContextStorage.getStore()?.requestId;

export const getTenantId = (): string | null | undefined => requestContextStorage.getStore()?.tenantId;

export const getTraceId = (): string | undefined => requestContextStorage.getStore()?.traceId;

export const setTraceId = (traceId: string): void => {
  const store = requestContextStorage.getStore();
  if (store) store.traceId = traceId;
};

// verify-jwt.ts corre en un hook `preHandler`, después de que request-id.ts
// (hook `onRequest`) ya llamó a `enterWith` -- no se puede volver a llamar
// `enterWith` sin perder el requestId ya guardado, así que se actualiza el
// store existente en el lugar.
export const setTenantId = (tenantId: string | null): void => {
  const store = requestContextStorage.getStore();
  if (store) {
    store.tenantId = tenantId;
  }
};
