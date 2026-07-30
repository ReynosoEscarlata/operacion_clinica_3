import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { TENANT_ID_HEADER } from '../lib/constants.js';
import { tenantContextStorage } from '../lib/tenant-context.js';

// Rutas exentas de requerir contexto de tenant: el directorio de doctores es
// público a propósito (RLS asimétrico, ver la migración SQL) -- un paciente
// sin cuenta necesita poder listar/ver doctores y sus horarios antes de que
// exista cualquier contexto de tenant (confirmado con Ricardo, Fase 3a).
// Crear un doctor o modificar disponibilidad SÍ requiere tenant (son
// mutaciones de un admin autenticado).
const TENANT_EXEMPT_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/v1\/doctors$/ },
  { method: 'GET', pattern: /^\/v1\/doctors\/[^/]+$/ },
  { method: 'GET', pattern: /^\/v1\/doctors\/[^/]+\/slots$/ },
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
