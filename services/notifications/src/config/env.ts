import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4005),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
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
});

export const env = schema.parse(process.env);
