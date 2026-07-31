import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { TENANT_ID_HEADER } from '../lib/constants.js';
import { tenantContextStorage } from '../lib/tenant-context.js';

// Rutas exentas de requerir contexto de tenant: son justo las que EMITEN o
// verifican identidad antes de que exista un tenant conocido (login/refresh/
// JWKS), o las que el actor de plataforma llama SIN tener un tenant propio
// (support-access, RFC-004: el gateway nunca reenvía x-internal-tenant-id
// para un actor con tenantId null -- ver gateway/src/routes/proxy.ts). Todo
// lo demás en este servicio (gestión de usuarios) requiere un tenant ya
// resuelto por el gateway. Distinto del patrón de "rutas públicas" del
// gateway (ahí el criterio es paciente-sin-cuenta); aquí no hay analogía de
// paciente — Auth no tiene rutas de paciente.
const TENANT_EXEMPT_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/v1\/auth\/login$/ },
  { method: 'POST', pattern: /^\/v1\/auth\/refresh$/ },
  { method: 'GET', pattern: /^\/v1\/auth\/\.well-known\/jwks\.json$/ },
  { method: 'POST', pattern: /^\/v1\/auth\/support-access$/ },
  // Plano de plataforma (Fase 6, ADR-017): mismo criterio que support-access
  // -- un actor platform_admin/platform_support no tiene tenant que enviar.
  { method: 'GET', pattern: /^\/v1\/platform-users\/active$/ },
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
    if (isTenantExempt(request.method, request.url)) {
      tenantContextStorage.enterWith({ tenantId: null });
      return;
    }

    const incoming = request.headers[TENANT_ID_HEADER];
    const tenantId = Array.isArray(incoming) ? incoming[0] : incoming;

    if (!tenantId) {
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
