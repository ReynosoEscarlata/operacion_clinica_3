import type { AwsClientConfig } from '@clinica/messaging';

import { env } from './env.js';

// Construye la config una sola vez a partir de las env vars validadas --
// evita repetir el spread condicional en cada punto que arma un cliente de
// AWS (server.ts, tests de integración).
export const buildAwsConfig = (): AwsClientConfig => ({
  region: env.AWS_REGION,
  ...(env.AWS_ENDPOINT_URL ? { endpointUrl: env.AWS_ENDPOINT_URL } : {}),
  ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    : {}),
});
