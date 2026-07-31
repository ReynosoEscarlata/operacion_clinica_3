import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthActor } from '@clinica/authz';

// Mismo molde que tenant-context.ts, aplicado al actor completo (rol +
// tenant + doctorId) que requirePermission()/el chequeo de propiedad en
// doctors.service.ts#addAvailability necesitan.
export const authActorStorage = new AsyncLocalStorage<AuthActor | null>();

export const getAuthActor = (): AuthActor | null | undefined => authActorStorage.getStore();
