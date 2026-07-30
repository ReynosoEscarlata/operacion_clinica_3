import type { AwsClientConfig } from '../../src/aws-clients.js';

// LocalStack corre en docker-compose (o localmente, ver docker-compose.yml
// raíz) -- estas pruebas usan infra real, nunca mocks del SDK (mismo
// principio que Postgres/Redis en el resto del repo).
export const LOCALSTACK_CONFIG: AwsClientConfig = {
  region: 'us-east-1',
  endpointUrl: process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
  accessKeyId: 'test',
  secretAccessKey: 'test',
};
