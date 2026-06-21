import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SENTRY_DSN: z.string().optional().default(''),
  // Dependencias síncronas explícitas según ADR-001-sync-vs-async.md: query
  // de slots a Doctors, PaymentIntent/refund a Payments.
  DOCTORS_SERVICE_URL: z.string().url(),
  PAYMENTS_SERVICE_URL: z.string().url(),
});

export const env = schema.parse(process.env);
