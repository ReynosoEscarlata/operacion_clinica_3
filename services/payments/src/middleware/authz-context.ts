import type { FastifyInstance, FastifyRequest } from 'fastify';

import { DOCTOR_ID_HEADER, USER_ROLE_HEADER, type AuthActor, type AuthenticatedRole } from '@clinica/authz';

import { TENANT_ID_HEADER } from '../lib/constants.js';
import { authActorStorage } from '../lib/authz-context.js';

const headerValue = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? null;
};

// Mismo molde que services/auth/appointments/doctors. Nunca rechaza una
// request por falta de USER_ROLE_HEADER (igual que tenant-context.ts de
// este servicio) -- la mayoría del tráfico es servicio-a-servicio, sin
// actor alguno.
export const registerAuthzContext = (app: FastifyInstance): void => {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const role = headerValue(request.headers[USER_ROLE_HEADER]);

    if (!role) {
      authActorStorage.enterWith(null);
      return;
    }

    const actor: AuthActor = {
      role: role as AuthenticatedRole,
      tenantId: headerValue(request.headers[TENANT_ID_HEADER]),
      doctorId: headerValue(request.headers[DOCTOR_ID_HEADER]),
    };
    request.authActor = actor;
    authActorStorage.enterWith(actor);
  });
};
