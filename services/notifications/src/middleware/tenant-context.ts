import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { TENANT_ID_HEADER } from '../lib/constants.js';
import { tenantContextStorage } from '../lib/tenant-context.js';

// A diferencia de Doctors/Appointments, Notifications no tiene ninguna ruta
// de lectura pública -- todo vive detrás de dead_letter:* (plano de
// plataforma) o se escribe desde el consumer de eventos de dominio (que usa
// runWithTenant directo, sin pasar por este middleware). Toda ruta bajo
// /v1/ requiere tenant.
const isTenantExempt = (url: string): boolean => !url.startsWith('/v1/');

export const registerTenantContext = (app: FastifyInstance): void => {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const incoming = request.headers[TENANT_ID_HEADER];
    const tenantId = Array.isArray(incoming) ? incoming[0] : incoming;

    if (!tenantId) {
      if (isTenantExempt(request.url)) {
        tenantContextStorage.enterWith({ tenantId: null });
        return;
      }

      await reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Contexto de tenant requerido',
          requestId: request.requestId,
        },
      });
      return;
    }

    tenantContextStorage.enterWith({ tenantId });
  });
};
