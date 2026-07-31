import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4005),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  // Rol restringido (sin BYPASSRLS, ADR-006) -- ver
  // docs/runbooks/migracion-tenant-id.md.
  DATABASE_URL_APP: z.string().min(1),
  SENTRY_DSN: z.string().optional().default(''),
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
  // Fase 3b (ADR-014): SNS/SQS reemplaza Redis Streams. AWS_ENDPOINT_URL
  // solo se setea en dev/test (LocalStack); en AWS real, el SDK usa la
  // cadena de credenciales por defecto (rol de la tarea ECS) sin overrides.
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ENDPOINT_URL: z.string().optional(),
  // Solo se setean en dev/test contra LocalStack (que no valida credenciales
  // reales, pero el SDK igual exige que existan) -- en AWS real se omiten y
  // el SDK usa la cadena de credenciales por defecto.
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  NOTIFICATIONS_DOMAIN_EVENTS_QUEUE_URL: z.string().min(1),
  NOTIFICATIONS_DOMAIN_EVENTS_DLQ_URL: z.string().min(1),
  NOTIFICATIONS_DOMAIN_EVENTS_MAX_RECEIVE_COUNT: z.coerce.number().default(5),
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
  // Fase 6 (ADR-017): sin sidecar xray-daemon en dev/docker-compose local
  // por default -- menos fricción, nada escucha en 127.0.0.1:2000 ahí.
  XRAY_ENABLED: z.coerce.boolean().default(false),
  // 1 = traza el 100% (dev/staging, tráfico bajo); prod usa un valor bajo
  // (ej. 0.05) inyectado por compute-stack.ts vía environments.ts.
  XRAY_SAMPLING_RATE: z.coerce.number().min(0).max(1).default(1),
});

export const env = schema.parse(process.env);
