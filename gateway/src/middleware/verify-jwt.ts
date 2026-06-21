import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../config/env.js';

// JWKS remoto cacheado por `jose` (no se consulta a Auth en cada request,
// ver RFC-001-bounded-contexts.md decisión 2: JWT stateless con llave
// pública de Auth, sin tocar su BD).
const jwks = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));

declare module 'fastify' {
  interface FastifyRequest {
    user?: { sub: string; role: string };
  }
}

/**
 * Rutas públicas según los contratos de packages/contracts/ (sin
 * `security: bearerAuth`): login, JWKS, navegación de doctores/slots para
 * reservar, creación de paciente, y el flujo de self-service del paciente
 * sobre su propia cita (crear, ver detalle, cancelar) — identificado por
 * posesión del UUID de la cita, no por sesión (el paciente no tiene cuenta,
 * ver RFC-001 decisión 1). Esto replica el comportamiento ya existente del
 * monolito (`src/modules/appointments/appointments.routes.ts`: solo
 * `complete` y `no-show` están detrás de `requireAdminAuth`, `cancel` no).
 * Todo lo demás (listar todas las citas, refunds, dead-letter, users)
 * requiere JWT de Admin/Staff.
 */
const PUBLIC_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/v1\/auth\/login$/ },
  { method: 'POST', pattern: /^\/v1\/auth\/refresh$/ },
  { method: 'GET', pattern: /^\/v1\/auth\/\.well-known\/jwks\.json$/ },
  { method: 'GET', pattern: /^\/v1\/doctors(\/[^/]+)?(\/slots)?$/ },
  { method: 'POST', pattern: /^\/v1\/patients$/ },
  { method: 'GET', pattern: /^\/v1\/patients\/by-email$/ },
  { method: 'GET', pattern: /^\/v1\/patients\/[^/]+$/ },
  { method: 'POST', pattern: /^\/v1\/appointments$/ },
  { method: 'GET', pattern: /^\/v1\/appointments\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/v1\/appointments\/[^/]+\/cancel$/ },
  { method: 'POST', pattern: /^\/v1\/webhooks\/stripe$/ },
];

export const isPublicRoute = (method: string, url: string): boolean => {
  // Rutas propias del gateway (no proxeadas), ej. /healthz, /metrics.
  if (!url.startsWith('/v1/')) {
    return true;
  }
  // request.url incluye el query string (ej. "?date=2026-06-22") — los
  // patrones de abajo solo describen el path, así que hay que descartarlo
  // antes de matchear o nunca van a coincidir en rutas con query params
  // (slots, by-email, etc.).
  const path = url.split('?')[0] ?? url;
  return PUBLIC_ROUTES.some((route) => route.method === method && route.pattern.test(path));
};

export const verifyJwt = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const isPublic = isPublicRoute(request.method, request.url);
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    if (!isPublic) {
      await reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Token requerido', requestId: request.id },
      });
    }
    return;
  }

  try {
    const token = authHeader.slice('Bearer '.length);
    const { payload } = await jwtVerify(token, jwks);
    request.user = { sub: String(payload.sub), role: String(payload['role']) };
  } catch (error) {
    request.log.warn({ err: error }, 'JWT inválido o expirado');
    if (!isPublic) {
      await reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Token inválido o expirado', requestId: request.id },
      });
      return;
    }
    // En una ruta pública un token roto no bloquea la request (el paciente
    // sin cuenta sigue pudiendo reservar/cancelar) — simplemente se ignora
    // y la request continúa sin `request.user`, igual que si no hubiera
    // mandado ningún token.
  }
};
