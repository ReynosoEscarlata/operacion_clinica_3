import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthActor } from '@clinica/authz';

// Mismo molde que tenant-context.ts, aplicado al actor completo (rol +
// tenant + doctorId) que requirePermission()/el filtro ABAC de repositorio
// necesitan. `null` = request sin actor autenticado (rutas exentas, ver
// middleware/authz-context.ts); `undefined` = fuera de un request con este
// contexto poblado (bug, revisar registerAuthzContext).
export const authActorStorage = new AsyncLocalStorage<AuthActor | null>();

export const getAuthActor = (): AuthActor | null | undefined => authActorStorage.getStore();
