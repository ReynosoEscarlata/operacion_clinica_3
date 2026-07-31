import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4003),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  // Rol restringido (sin BYPASSRLS, ADR-006) -- ver
  // docs/runbooks/migracion-tenant-id.md.
  DATABASE_URL_APP: z.string().min(1),
  SENTRY_DSN: z.string().optional().default(''),
  // Fase 3b (ADR-014): SNS reemplaza Redis Streams. AWS_ENDPOINT_URL y las
  // credenciales solo se setean en dev/test (LocalStack); en AWS real, el
  // SDK usa la cadena de credenciales por defecto (rol de la tarea ECS).
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ENDPOINT_URL: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  DOMAIN_EVENTS_TOPIC_ARN: z.string().min(1),
  // Fase 6 (ADR-017): EMF llega a CloudWatch por el log driver `awslogs` que
  // ya existe (sin IAM nuevo) -- deshabilitado por default para que la
  // suite de tests no escupa documentos EMF en cada request.
  EMF_ENABLED: z.coerce.boolean().default(false),
  EMF_NAMESPACE: z.string().default('Clinica'),
  // Dimensión `Environment` de las métricas EMF -- distinto de NODE_ENV
  // (development/test/production): calza con `config.envName` de
  // infra/config/environments.ts (dev/staging/prod), inyectado por
  // compute-stack.ts en AWS real.
  ENV_NAME: z.string().default('dev'),
});

export const env = schema.parse(process.env);
