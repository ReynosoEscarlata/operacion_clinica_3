import { AsyncLocalStorage } from 'node:async_hooks';

import type { AuthActor } from '@clinica/authz';

// Mismo molde que services/auth. A diferencia de Auth/Doctors/Appointments,
// en Payments `null` (sin actor) es el caso COMÚN, no la excepción: la
// mayoría del tráfico es servicio-a-servicio (Appointments llamando
// directo, sin pasar por el gateway, ver middleware/tenant-context.ts) y
// nunca trae USER_ROLE_HEADER.
export const authActorStorage = new AsyncLocalStorage<AuthActor | null>();

export const getAuthActor = (): AuthActor | null | undefined => authActorStorage.getStore();
