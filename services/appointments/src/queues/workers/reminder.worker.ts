import type { EventHandler } from '@clinica/messaging';

import type { Logger } from '../../lib/logger.js';
import { requestContextStorage } from '../../lib/request-context.js';
import { runWithTenant } from '../../lib/tenant-context.js';
import type { AppointmentRepository } from '../../modules/appointments/appointments.repository.js';
import type { AppointmentStateMachine } from '../../modules/appointments/state-machine.js';
import type { ReminderJobData } from '../jobs/reminder.job.js';

export interface ReminderJobDeps {
  appointmentRepository: AppointmentRepository;
  stateMachine: AppointmentStateMachine;
  logger: Logger;
}

export interface ReminderHandlerDeps {
  appointmentRepository: AppointmentRepository;
  stateMachine: AppointmentStateMachine;
  logger: Logger;
}

// A diferencia del monolito, este worker NO envía el email de recordatorio
// — esa responsabilidad es de Notifications (RFC-001), que lo hace al
// consumir el evento AppointmentStatusChanged/REMINDER_SENT publicado por
// la state machine (Outbox). Este worker solo hace la transición
// PAID -> REMINDED en el momento correcto (24h antes de la cita).
export const processReminderJob = async (
  data: ReminderJobData,
  deps: ReminderJobDeps,
): Promise<void> => {
  const appointment = await deps.appointmentRepository.findById(data.appointmentId);

  if (!appointment) {
    throw new Error(`Cita no encontrada: ${data.appointmentId}`);
  }

  // Idempotencia: si ya fue recordada o transicionó de PAID, no hacer nada.
  if (appointment.status !== 'PAID') {
    deps.logger.info(
      { appointmentId: data.appointmentId, currentStatus: appointment.status },
      'Job de recordatorio ignorado: cita no está en estado PAID',
    );
    return;
  }

  await deps.stateMachine.transition(appointment.id, 'REMINDED', {
    trigger: 'reminder-job',
    eventType: 'REMINDER_SENT',
  });
};

// Reemplaza buildReminderWorker (BullMQ): consume la cola
// appointment-reminders vía @clinica/messaging. El tenantId ya viene en el
// envelope -- no hace falta resolverlo de nuevo desde la BD.
export const buildReminderEventHandler = (deps: ReminderHandlerDeps): EventHandler => {
  return async (event) => {
    const { appointmentId, requestId } = event.payload as { appointmentId: string; requestId?: string };
    const jobLogger = deps.logger.child({
      queue: 'appointment-reminders',
      eventId: event.eventId,
      ...(requestId ? { requestId } : {}),
    });

    await requestContextStorage.run({ requestId: requestId ?? event.eventId }, () =>
      runWithTenant(event.tenantId, () =>
        processReminderJob({ appointmentId }, { ...deps, logger: jobLogger }),
      ),
    );
  };
};
