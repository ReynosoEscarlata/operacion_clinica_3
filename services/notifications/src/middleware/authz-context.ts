import {
  DOCTOR_ID_HEADER,
  SUPPORT_GRANT_ID_HEADER,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
  USER_ROLE_HEADER,
  type AuthActor,
  type AuthenticatedRole,
} from '@clinica/authz';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { authActorStorage } from '../lib/authz-context.js';

const headerValue = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? null;
};

// Mismo molde que los demás servicios. Nunca rechaza por falta del header
// (no hay tenant-context.ts acá todavía, Fase 3b) -- las rutas de
// dead-letter dependen únicamente de requirePermission() para su
// enforcement.
export const registerAuthzContext = (app: FastifyInstance): void => {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const role = headerValue(request.headers[USER_ROLE_HEADER]);

    if (!role) {
      authActorStorage.enterWith(null);
      return;
    }

    const actor: AuthActor = {
      sub: headerValue(request.headers[USER_ID_HEADER]) ?? '',
      role: role as AuthenticatedRole,
      tenantId: headerValue(request.headers[TENANT_ID_HEADER]),
      doctorId: headerValue(request.headers[DOCTOR_ID_HEADER]),
    };
    request.authActor = actor;
    authActorStorage.enterWith(actor);

    // RFC-004, escalada de platform_support: trazabilidad mínima vía
    // logging estructurado, ver el mismo comentario en
    // services/auth/src/middleware/authz-context.ts.
    const supportGrantId = headerValue(request.headers[SUPPORT_GRANT_ID_HEADER]);
    if (supportGrantId) {
      request.log.info(
        { supportGrantId, actorRole: actor.role, tenantId: actor.tenantId },
        'Acceso de soporte de plataforma',
      );
    }
  });
};
