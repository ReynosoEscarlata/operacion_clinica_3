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
});

export const env = schema.parse(process.env);
