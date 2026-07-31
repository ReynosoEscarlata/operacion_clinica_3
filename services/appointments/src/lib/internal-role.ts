import { ROLES } from '@clinica/authz';
import type { FastifyRequest } from 'fastify';

import type { CancelledBy } from '../modules/appointments/appointments.service.js';

const INTERNAL_ROLE_HEADER = 'x-internal-user-role';
// RFC-004: cualquiera de los 7 roles del catálogo cuenta como "no es el
// paciente sin cuenta" para efectos de este timeline -- antes (Fase 3) era
// un allowlist de 2 valores (ADMIN/STAFF), ahora se valida contra el
// catálogo real de @clinica/authz en vez de reinventar la lista aquí.
const KNOWN_ROLES = new Set<string>(ROLES);

// El gateway reenvía este header solo cuando la request llegó con un JWT
// válido (ver gateway/src/routes/proxy.ts) — confiamos en él porque el
// servicio solo es alcanzable desde la red interna de Docker/Compose, igual
// criterio que en services/auth/src/modules/users/users.routes.ts. Sin
// header (paciente sin cuenta, identificado por el UUID de la cita) se
// asume PATIENT.
export const resolveCancelledBy = (request: FastifyRequest): CancelledBy => {
  const role = request.headers[INTERNAL_ROLE_HEADER];
  const normalizedRole = Array.isArray(role) ? role[0] : role;
  return normalizedRole && KNOWN_ROLES.has(normalizedRole) ? 'ADMIN' : 'PATIENT';
};
