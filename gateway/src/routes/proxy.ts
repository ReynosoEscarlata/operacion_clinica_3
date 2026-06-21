import fastifyHttpProxy from '@fastify/http-proxy';
import type { FastifyInstance } from 'fastify';

import { env } from '../config/env.js';

/**
 * Enrutamiento por prefijo hacia cada servicio, según los contratos en
 * packages/contracts/. El prefijo se reenvía sin reescribir (rewritePrefix
 * == prefix) porque cada servicio expone sus rutas bajo el mismo /v1/...
 * documentado en su propio OpenAPI.
 */
const ROUTES: ReadonlyArray<{ prefix: string; upstream: string }> = [
  { prefix: '/v1/auth', upstream: env.AUTH_SERVICE_URL },
  { prefix: '/v1/users', upstream: env.AUTH_SERVICE_URL },
  { prefix: '/v1/patients', upstream: env.APPOINTMENTS_SERVICE_URL },
  { prefix: '/v1/appointments', upstream: env.APPOINTMENTS_SERVICE_URL },
  { prefix: '/v1/admin', upstream: env.APPOINTMENTS_SERVICE_URL },
  { prefix: '/v1/doctors', upstream: env.DOCTORS_SERVICE_URL },
  { prefix: '/v1/payment-intents', upstream: env.PAYMENTS_SERVICE_URL },
  { prefix: '/v1/refunds', upstream: env.PAYMENTS_SERVICE_URL },
  { prefix: '/v1/webhooks', upstream: env.PAYMENTS_SERVICE_URL },
  { prefix: '/v1/dead-letter', upstream: env.NOTIFICATIONS_SERVICE_URL },
];

export const registerProxyRoutes = async (app: FastifyInstance): Promise<void> => {
  for (const route of ROUTES) {
    await app.register(fastifyHttpProxy, {
      prefix: route.prefix,
      rewritePrefix: route.prefix,
      upstream: route.upstream,
      replyOptions: {
        // Si la request llegó con un JWT válido (ej. un Admin/Staff
        // logueado que cancela una cita desde el panel, en una ruta que
        // por lo demás es pública para el paciente sin cuenta), se
        // reenvía el rol al servicio upstream en un header interno. El
        // servicio decide qué hacer con eso (ej. distinguir cancelledBy
        // ADMIN vs PATIENT) — es un límite de confianza de red interna,
        // mismo criterio que en services/auth/src/modules/users/users.routes.ts.
        rewriteRequestHeaders: (request, headers) => ({
          ...headers,
          ...(request.user ? { 'x-internal-user-role': request.user.role } : {}),
        }),
      },
    });
  }
};
