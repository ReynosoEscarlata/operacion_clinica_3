import type { EventHandler } from '@clinica/messaging';

import type { NotificationService } from '../modules/notifications/notification.service.js';
import { runWithTenant } from './tenant-context.js';

// Mapa type → handler compartido entre el consumer real (server.ts) y el
// retry manual de dead-letter (dead-letter.service.ts): reintentar una
// entrada no republica nada a SNS/SQS (Notifications no es dueño de estos
// eventos, solo los consume) — re-ejecuta el mismo handler con el payload
// guardado. El tenantId viene directo del envelope (Fase 3b, ADR-014): cada
// handler entra en su propio contexto de tenant antes de tocar cualquier
// repositorio -- el consumer corre en background, sin ningún TenantContext
// de request.
export const buildEventHandlers = (notificationService: NotificationService): Record<string, EventHandler> => ({
  AppointmentCreated: (event) =>
    runWithTenant(event.tenantId, () => notificationService.handleAppointmentCreated(event.payload as never)),
  AppointmentStatusChanged: (event) =>
    runWithTenant(event.tenantId, () => notificationService.handleAppointmentStatusChanged(event.payload as never)),
  PatientUpdated: (event) =>
    runWithTenant(event.tenantId, () => notificationService.handlePatientUpdated(event.payload as never)),
  DoctorCreated: (event) =>
    runWithTenant(event.tenantId, () => notificationService.handleDoctorEvent(event.payload as never)),
  DoctorUpdated: (event) =>
    runWithTenant(event.tenantId, () => notificationService.handleDoctorEvent(event.payload as never)),
  PaymentFailed: (event) =>
    runWithTenant(event.tenantId, () => notificationService.handlePaymentFailed(event.payload as never)),
});
