// Nombres de campo con PII/credenciales que nunca deben salir en texto
// plano en los logs de ningún servicio (Fase 5). Se usa como `redact.paths`
// de Pino en cada `lib/logger.ts` -- Pino censura cualquier clave con este
// nombre en cualquier profundidad del objeto logueado (comodín `*`), no
// solo en la raíz.
export const COMMON_REDACT_PATHS = [
  'email',
  '*.email',
  'phone',
  '*.phone',
  'name',
  '*.name',
  'to',
  '*.to',
  'passwordHash',
  '*.passwordHash',
  'tokenHash',
  '*.tokenHash',
  'stripeCustomerId',
  '*.stripeCustomerId',
  'stripePaymentIntentId',
  '*.stripePaymentIntentId',
];

export const REDACT_CENSOR = '[REDACTED]';
