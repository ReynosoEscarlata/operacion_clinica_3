import type { AuthenticatedRole } from './roles.js';

// Identidad resuelta a partir de los headers internos que reenvía el
// gateway (o, dentro de un servicio, del contexto ambiental poblado por
// authz-context.ts). `tenantId` null = actor de plataforma (RFC-003).
// `doctorId` solo es relevante cuando role === 'doctor' (RFC-004, regla
// ABAC de propiedad); null en cualquier otro rol. `sub` es el id del User
// (claim `sub` del JWT, RFC-001 decisión 2) -- necesario para cualquier
// registro de auditoría que necesite saber QUIÉN actuó, no solo con qué
// rol (ej. SupportAccessGrant.actorId, RFC-004 "Escalada de privilegios").
export interface AuthActor {
  sub: string;
  role: AuthenticatedRole;
  tenantId: string | null;
  doctorId: string | null;
}
