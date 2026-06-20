import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

// Permite que cualquier logger.info/warn/error (incluso en services y
// repositories que no reciben request.log explícitamente) incluya el
// requestId automáticamente vía el mixin de pino, sin tener que pasarlo
// como parámetro a través de toda la cadena Route → Controller → Service → Repository.
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined => requestContextStorage.getStore()?.requestId;
