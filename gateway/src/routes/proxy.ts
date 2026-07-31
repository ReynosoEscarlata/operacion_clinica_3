import type { IncomingHttpHeaders } from 'node:http';

import {
  DOCTOR_ID_HEADER,
  SUPPORT_GRANT_ID_HEADER,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
  USER_ROLE_HEADER,
} from '@clinica/authz';
import fastifyHttpProxy from '@fastify/http-proxy';
import type { FastifyInstance } from 'fastify';

import { env } from '../config/env.js';

// Subconjunto estructural de FastifyRequest -- evita atarse al tipo exacto
// que exige la firma de rewriteRequestHeaders de @fastify/http-proxy (que
// difiere entre HTTP/HTTP2 y no vale la pena replicar aquí), y permite
// testear esta función con un objeto mínimo sin levantar el proxy completo.
interface RequestWithUser {
  user?: {
    sub: string;
    role: string;
    tenantId: string | null;
    doctorId: string | null;
    supportGrantId: string | null;
  };
}

// Si la request llegó con un JWT válido (ej. un actor autenticado que
// cancela una cita desde el panel, en una ruta que por lo demás es pública
// para el paciente sin cuenta), se reenvían sus claims al servicio upstream
// en headers internos (constantes compartidas de @clinica/authz, ADR-012)
// — el servicio decide qué hacer con eso (ej. requirePermission(), o
// distinguir cancelledBy) — es un límite de confianza de red interna,
// mismo criterio que en services/auth/src/modules/users/users.routes.ts.
// Exportada (en vez de inline en registerProxyRoutes) para poder testearla
// sin levantar el proxy completo. El tipo de retorno es `unknown` a
// propósito: @fastify/http-proxy acepta tanto IncomingHttpHeaders (HTTP/1)
// como su equivalente HTTP/2, y replicar esa unión aquí no aporta nada --
// la firma real se castea en el único call site (registerProxyRoutes).
export const buildInternalHeaders = (request: RequestWithUser, headers: IncomingHttpHeaders): unknown => ({
  ...headers,
  ...(request.user ? { [USER_ROLE_HEADER]: request.user.role, [USER_ID_HEADER]: request.user.sub } : {}),
  // tenant_id nunca lo pone el cliente -- solo se reenvia si vino de un JWT
  // verificado con ese claim (RFC-003). Un usuario de plataforma (tenantId
  // null) no reenvia el header en absoluto, igual que un request sin JWT.
  ...(request.user?.tenantId ? { [TENANT_ID_HEADER]: request.user.tenantId } : {}),
  // doctor_id solo presente para role === 'doctor' (RFC-004, filtro ABAC de
  // propiedad en appointments/doctors).
  ...(request.user?.doctorId ? { [DOCTOR_ID_HEADER]: request.user.doctorId } : {}),
  // Solo presente bajo un JWT de elevación emitido por
  // POST /v1/auth/support-access (RFC-004, escalada de platform_support) --
  // cada servicio lo usa únicamente para loguear el acceso, ver
  // authz-context.ts de cada uno.
  ...(request.user?.supportGrantId ? { [SUPPORT_GRANT_ID_HEADER]: request.user.supportGrantId } : {}),
});

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
        rewriteRequestHeaders: (request, headers) =>
          buildInternalHeaders(request, headers) as IncomingHttpHeaders,
      },
    });
  }
};
