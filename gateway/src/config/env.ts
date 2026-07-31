import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AUTH_JWKS_URL: z.string().url(),
  AUTH_SERVICE_URL: z.string().url(),
  APPOINTMENTS_SERVICE_URL: z.string().url(),
  DOCTORS_SERVICE_URL: z.string().url(),
  PAYMENTS_SERVICE_URL: z.string().url(),
  NOTIFICATIONS_SERVICE_URL: z.string().url(),
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
