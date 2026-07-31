// Fase 3b (ADR-014): unica fuente de verdad para los maxReceiveCount de cada
// cola -- messaging-stack.ts los usa para crear las QueueWithDlq, y
// compute-stack.ts los inyecta como env var a cada servicio (que los usa
// para configurar su propio consumer, ver services/*/src/config/env.ts).
// Sin esto el numero de reintentos quedaria escrito dos veces y podria
// divergir (ya paso una vez con scripts/localstack-setup.mjs, que SI tiene
// que duplicarlo a mano porque scripts/ e infra/ son proyectos npm
// separados sin workspace en comun).
export const MAX_RECEIVE_COUNTS = {
  domainEvents: 5,
  appointmentExpiration: 1,
  appointmentReminders: 3,
  appointmentNoShow: 1,
} as const;

// Nombre del grupo de EventBridge Scheduler donde Appointments crea los
// one-time schedules de expiration/reminders (ver
// services/appointments/src/queues/jobs/*.job.ts).
export const APPOINTMENT_SCHEDULE_GROUP_NAME_SUFFIX = 'appointment-schedules';

// Cron del scan recurrente de no-show -- reemplaza el `repeat: { pattern }`
// que tenia BullMQ. Infra estatica (CfnSchedule), a diferencia de los
// one-time schedules que crea la aplicacion en runtime.
export const APPOINTMENT_NOSHOW_SCAN_RATE_MINUTES = 15;
