import { randomUUID } from 'node:crypto';

import { exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';

export interface SigningKeys {
  privateKey: KeyLike;
  kid: string;
  publicJwk: JWK;
}

// Par de llaves RS256 generado en memoria al iniciar el proceso. Limitación
// conocida y aceptada para esta fase (RFC-001 decisión 2 prioriza JWT
// stateless simple): un reinicio del servicio invalida los tokens emitidos
// antes del reinicio y rota el `kid` publicado en JWKS. Pasar a una llave
// persistida (secret manager / env var PEM) es un cambio de infraestructura,
// no de diseño, y se puede hacer sin tocar contratos públicos.
let cached: Promise<SigningKeys> | undefined;

export const getSigningKeys = (): Promise<SigningKeys> => {
  cached ??= (async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const kid = randomUUID();
    const publicJwk = await exportJWK(publicKey);
    return {
      privateKey,
      kid,
      publicJwk: { ...publicJwk, kid, alg: 'RS256', use: 'sig' },
    };
  })();
  return cached;
};
