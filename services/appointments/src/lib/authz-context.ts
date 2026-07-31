import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthActor } from '@clinica/authz';

// Mismo molde que tenant-context.ts, aplicado al actor completo (rol +
// tenant + doctorId) que requirePermission()/el filtro ABAC de propiedad
// del doctor (lib/abac.ts) necesitan. `null` = request sin actor
// autenticado (paciente sin cuenta, RFC-001); `undefined` = fuera de un
// request con este contexto poblado.
export const authActorStorage = new AsyncLocalStorage<AuthActor | null>();

export const getAuthActor = (): AuthActor | null | undefined => authActorStorage.getStore();
