import { SignJWT } from 'jose';

import { env } from '../config/env.js';
import { getSigningKeys } from './keys.js';

export interface AccessTokenClaims {
  sub: string;
  role: string;
}

export const signAccessToken = async (claims: AccessTokenClaims): Promise<string> => {
  const { privateKey, kid } = await getSigningKeys();

  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
};
