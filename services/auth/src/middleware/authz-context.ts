import type { FastifyInstance, FastifyRequest } from 'fastify';

import { DOCTOR_ID_HEADER, USER_ROLE_HEADER, type AuthActor, type AuthenticatedRole } from '@clinica/authz';

import { TENANT_ID_HEADER } from '../lib/constants.js';
import { authActorStorage } from '../lib/authz-context.js';

const headerValue = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? null;
};

// Puebla request.authActor (lo lee requirePermission()) y el contexto
// ambiental (lo lee getAuthActor(), para el filtro ABAC de repositorio) a
// partir de los headers internos que reenvía el gateway -- nunca de
// header/query/body del cliente (mismo límite de confianza que
// tenant-context.ts). Sin USER_ROLE_HEADER no hay actor: la request sigue
// (rutas públicas como login/refresh no tienen JWT todavía), pero
// requirePermission() la rechazará si la ruta exige un permiso.
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
