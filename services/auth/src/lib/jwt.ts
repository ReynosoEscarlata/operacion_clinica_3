import { SignJWT } from 'jose';

import { env } from '../config/env.js';
import { getSigningKeys } from './keys.js';

export interface AccessTokenClaims {
  sub: string;
  role: string;
  // null para roles de plataforma (RFC-003) -- no se construyen en esta
  // fase, pero el claim ya existe para cuando se construyan (Fase 4).
  tenantId: string | null;
}

export const signAccessToken = async (claims: AccessTokenClaims): Promise<string> => {
  const { privateKey, kid } = await getSigningKeys();

  return new SignJWT({ role: claims.role, tenant_id: claims.tenantId })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
};
