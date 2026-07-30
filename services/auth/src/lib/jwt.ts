import { SignJWT } from 'jose';

import { env } from '../config/env.js';
import { getSigningKeys } from './keys.js';

export interface AccessTokenClaims {
  sub: string;
  // Valor de @clinica/authz (snake_case minúscula, ej. "clinic_owner") --
  // el caller (auth.service.ts) lo resuelve con users.mapper.ts#toAuthzRole
  // antes de llegar acá. jwt.ts no conoce el enum de Prisma.
  role: string;
  // null para roles de plataforma (RFC-003).
  tenantId: string | null;
  // Solo relevante si role === 'doctor' (RFC-004, filtro ABAC de propiedad
  // "un doctor solo ve sus propias citas") -- null en cualquier otro rol.
  doctorId: string | null;
}

export const signAccessToken = async (claims: AccessTokenClaims): Promise<string> => {
  const { privateKey, kid } = await getSigningKeys();

  return new SignJWT({ role: claims.role, tenant_id: claims.tenantId, doctor_id: claims.doctorId })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
};
