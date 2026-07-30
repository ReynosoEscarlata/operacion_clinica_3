import type { AuthenticatedRole } from './roles.js';

// Identidad resuelta a partir de los headers internos que reenvía el
// gateway (o, dentro de un servicio, del contexto ambiental poblado por
// authz-context.ts). `tenantId` null = actor de plataforma (RFC-003).
// `doctorId` solo es relevante cuando role === 'doctor' (RFC-004, regla
// ABAC de propiedad); null en cualquier otro rol.
export interface AuthActor {
  role: AuthenticatedRole;
  tenantId: string | null;
  doctorId: string | null;
}
