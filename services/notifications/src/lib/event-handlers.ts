import type { NotificationService } from '../modules/notifications/notification.service.js';
import type { EventHandler } from './event-consumer.js';

// Mapa type → handler compartido entre el consumer real (server.ts) y el
// retry manual de dead-letter (modules/admin): reintentar una entrada no
// republica nada al stream (Notifications no es dueño de estos eventos,
// solo los consume) — re-ejecuta el mismo handler con el payload guardado.
export const buildEventHandlers = (notificationService: NotificationService): Record<string, EventHandler> => ({
  AppointmentCreated: (event) => notificationService.handleAppointmentCreated(event.payload as never),
  AppointmentStatusChanged: (event) => notificationService.handleAppointmentStatusChanged(event.payload as never),
  PatientUpdated: (event) => notificationService.handlePatientUpdated(event.payload as never),
  DoctorCreated: (event) => notificationService.handleDoctorEvent(event.payload as never),
  DoctorUpdated: (event) => notificationService.handleDoctorEvent(event.payload as never),
  PaymentFailed: (event) => notificationService.handlePaymentFailed(event.payload as never),
});
