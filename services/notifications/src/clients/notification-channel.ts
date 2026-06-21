export interface NotificationMessage {
  to: string;
  subject: string;
  body: string;
}

// Abstracción de canal (PLAN.md Fase 2 paso 3): EmailChannel es la primera
// implementación; agregar SmsChannel más adelante es solo otra clase que
// implementa esta misma interfaz — el resto del servicio (notification.service.ts)
// no cambia. Esto es lo que hace "trivial" el PR cronometrado de SMS.
export interface NotificationChannel {
  readonly name: string;
  send: (message: NotificationMessage) => Promise<void>;
}
