import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthActor } from '@clinica/authz';

// Mismo molde que los demás servicios. Notifications todavía no tiene
// tenant-context.ts (tenancy diferida a Fase 3b) -- los permisos que
// expone hoy (dead_letter:*) son exclusivos del plano de plataforma y no
// dependen de tenantId, pero AuthActor lo conserva por consistencia de
// forma con el resto de los servicios.
export const authActorStorage = new AsyncLocalStorage<AuthActor | null>();

export const getAuthActor = (): AuthActor | null | undefined => authActorStorage.getStore();
