import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  // Rol restringido (sin BYPASSRLS, ADR-006) -- ver
  // docs/runbooks/migracion-tenant-id.md.
  DATABASE_URL_APP: z.string().min(1),
  SENTRY_DSN: z.string().optional().default(''),
  // Dependencias síncronas explícitas según ADR-001-sync-vs-async.md: query
  // de slots a Doctors, PaymentIntent/refund a Payments.
  DOCTORS_SERVICE_URL: z.string().url(),
  PAYMENTS_SERVICE_URL: z.string().url(),
  // Fase 3b (ADR-014): SNS/SQS/EventBridge Scheduler reemplaza Redis Streams
  // + BullMQ. AWS_ENDPOINT_URL y las credenciales solo se setean en dev/test
  // (LocalStack); en AWS real, el SDK usa la cadena de credenciales por
  // defecto (rol de la tarea ECS).
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ENDPOINT_URL: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  DOMAIN_EVENTS_TOPIC_ARN: z.string().min(1),
  // Cola propia suscrita al topic de eventos de dominio -- consume
  // PaymentSucceeded/PaymentFailed publicados por Payments.
  APPOINTMENTS_DOMAIN_EVENTS_QUEUE_URL: z.string().min(1),
  APPOINTMENTS_DOMAIN_EVENTS_DLQ_URL: z.string().min(1),
  APPOINTMENTS_DOMAIN_EVENTS_MAX_RECEIVE_COUNT: z.coerce.number().default(5),
  // Reemplaza el `delay` de BullMQ: EventBridge Scheduler agenda un
  // one-time schedule que entrega el mensaje a esta cola en el momento
  // exacto (CLAUDE.md: 1 intento, sin backoff, sin dead-letter).
  APPOINTMENT_EXPIRATION_QUEUE_URL: z.string().min(1),
  APPOINTMENT_EXPIRATION_QUEUE_ARN: z.string().min(1),
  APPOINTMENT_EXPIRATION_MAX_RECEIVE_COUNT: z.coerce.number().default(1),
  // CLAUDE.md: 3 intentos, backoff exponencial, con dead-letter.
  APPOINTMENT_REMINDERS_QUEUE_URL: z.string().min(1),
  APPOINTMENT_REMINDERS_QUEUE_ARN: z.string().min(1),
  APPOINTMENT_REMINDERS_DLQ_URL: z.string().min(1),
  APPOINTMENT_REMINDERS_MAX_RECEIVE_COUNT: z.coerce.number().default(3),
  // Job de sistema cross-tenant recurrente -- el trigger (rate(15 minutes))
  // es infra estática (CfnSchedule, ver PLAN.md CDK), no algo que este
  // servicio agende en runtime. Solo consume.
  APPOINTMENT_NOSHOW_QUEUE_URL: z.string().min(1),
  // Usados al crear los one-time schedules de expiration/reminders.
  SCHEDULER_GROUP_NAME: z.string().min(1),
  SCHEDULER_EXECUTION_ROLE_ARN: z.string().min(1),
});

export const env = schema.parse(process.env);
