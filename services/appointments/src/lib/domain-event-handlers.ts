import type { EventHandler } from '@clinica/messaging';

import type { AppointmentService } from '../modules/appointments/appointments.service.js';
import { AppError } from './app-error.js';
import type { Logger } from './logger.js';
import { runWithTenant } from './tenant-context.js';

export interface DomainEventHandlersDeps {
  appointmentService: AppointmentService;
  logger: Logger;
}

// Handlers de los eventos de dominio que Appointments consume (publicados
// por Payments). Se construyen una sola vez en server.ts y se comparten
// entre el consumer real (startQueueConsumer) y el retry manual de
// dead-letter (admin.repository.ts) -- "reintentar" invoca el MISMO handler,
// no una copia. El tenantId viene directo del envelope (ADR-014): ya no
// hace falta resolverlo desde el appointmentId vía resolveTenantForAppointment.
export const buildDomainEventHandlers = (deps: DomainEventHandlersDeps): Record<string, EventHandler> => ({
  PaymentSucceeded: async (event) => {
    const { appointmentId, paymentIntentId } = event.payload as {
      appointmentId: string;
      paymentIntentId: string;
    };

    await runWithTenant(event.tenantId, async () => {
      try {
        await deps.appointmentService.confirmPayment(appointmentId, paymentIntentId);
      } catch (error) {
        if (error instanceof AppError && error.code === 'INVALID_STATE_TRANSITION') {
          deps.logger.info(
            { appointmentId },
            'PaymentSucceeded ignorado: la cita ya no está en CONFIRMED (evento duplicado o fuera de orden)',
          );
          return;
        }
        throw error;
      }
    });
  },

  PaymentFailed: async (event) => {
    const { appointmentId, paymentIntentId, reason } = event.payload as {
      appointmentId: string;
      paymentIntentId: string;
      reason: string | null;
    };

    await runWithTenant(event.tenantId, () =>
      deps.appointmentService.recordPaymentFailed(appointmentId, paymentIntentId, reason),
    );
  },
});
