import type { FastifyRequest } from 'fastify';

import type { CancelledBy } from '../modules/appointments/appointments.service.js';

const INTERNAL_ROLE_HEADER = 'x-internal-user-role';
const ADMIN_ROLES = new Set(['ADMIN', 'STAFF']);

// El gateway reenvía este header solo cuando la request llegó con un JWT
// válido (ver gateway/src/routes/proxy.ts) — confiamos en él porque el
// servicio solo es alcanzable desde la red interna de Docker/Compose, igual
// criterio que en services/auth/src/modules/users/users.routes.ts. Sin
// header (paciente sin cuenta, identificado por el UUID de la cita) se
// asume PATIENT.
export const resolveCancelledBy = (request: FastifyRequest): CancelledBy => {
  const role = request.headers[INTERNAL_ROLE_HEADER];
  const normalizedRole = Array.isArray(role) ? role[0] : role;
  return normalizedRole && ADMIN_ROLES.has(normalizedRole) ? 'ADMIN' : 'PATIENT';
};
