import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { TENANT_ID_HEADER } from '../lib/constants.js';
import { tenantContextStorage } from '../lib/tenant-context.js';

// Rutas exentas de requerir el header de tenant: son las públicas por
// posesión de UUID o las que resuelven su propio tenant a partir de un
// doctorId dentro del body/query (RFC-003, confirmado con Ricardo en Fase
// 3a) -- en ambos casos el servicio/controlador resuelve el tenant real por
// su cuenta (ver runWithTenant en tenant-context.ts) en vez de depender de
// este header. Todo lo demás (listar, completar, marcar no-show, admin)
// requiere el header, poblado por el gateway a partir del JWT del actor
// autenticado.
const TENANT_EXEMPT_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/v1\/patients$/ },
  { method: 'GET', pattern: /^\/v1\/patients\/by-email$/ },
  { method: 'GET', pattern: /^\/v1\/patients\/[^/]+$/ },
  { method: 'POST', pattern: /^\/v1\/appointments$/ },
  { method: 'GET', pattern: /^\/v1\/appointments\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/v1\/appointments\/[^/]+\/cancel$/ },
];

const isTenantExempt = (method: string, url: string): boolean => {
  if (!url.startsWith('/v1/')) {
    return true;
  }
  const path = url.split('?')[0] ?? url;
  return TENANT_EXEMPT_ROUTES.some((route) => route.method === method && route.pattern.test(path));
};

export const registerTenantContext = (app: FastifyInstance): void => {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const incoming = request.headers[TENANT_ID_HEADER];
    const tenantId = Array.isArray(incoming) ? incoming[0] : incoming;

    if (!tenantId) {
      if (isTenantExempt(request.method, request.url)) {
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
