import type { EventHandler } from '@clinica/messaging';
import type { AppointmentStatus } from '@prisma/client';

import type { Logger } from '../../lib/logger.js';
import { requestContextStorage } from '../../lib/request-context.js';
import { runWithTenant } from '../../lib/tenant-context.js';
import type { AppointmentStateMachine } from '../../modules/appointments/state-machine.js';
import type { ExpirationJobData } from '../jobs/expiration.job.js';

interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface ExpirationJobDeps {
  findStatusById: (appointmentId: string) => Promise<AppointmentStatus | null>;
  stateMachine: Pick<AppointmentStateMachine, 'transition'>;
  logger: MinimalLogger;
}

export interface ExpirationHandlerDeps {
  findStatusById: (appointmentId: string) => Promise<AppointmentStatus | null>;
  stateMachine: AppointmentStateMachine;
  logger: Logger;
}

export const processExpirationJob = async (
  data: ExpirationJobData,
  deps: ExpirationJobDeps,
): Promise<void> => {
  const status = await deps.findStatusById(data.appointmentId);

  if (!status) {
    deps.logger.warn({ appointmentId: data.appointmentId }, 'Job de expiración: cita no encontrada');
    return;
  }

  if (status !== 'PENDING') {
    deps.logger.info(
      { appointmentId: data.appointmentId, currentStatus: status },
      'Job de expiración ignorado: la cita ya no está pendiente',
    );
    return;
  }

  await deps.stateMachine.transition(data.appointmentId, 'CANCELLED', {
    trigger: 'expiration',
    cancellationReason: 'No se completó el pago dentro de los 30 minutos',
  });
};

// Reemplaza buildExpirationWorker (BullMQ): consume la cola
// appointment-expiration vía @clinica/messaging. El tenantId ya viene en el
// envelope (lo puso enqueueAppointmentExpiration) -- no hace falta
// resolverlo de nuevo desde la BD como hacía el Worker de BullMQ.
export const buildExpirationEventHandler = (deps: ExpirationHandlerDeps): EventHandler => {
  return async (event) => {
    const { appointmentId, requestId } = event.payload as { appointmentId: string; requestId?: string };
    const jobLogger = deps.logger.child({
      queue: 'appointment-expiration',
      eventId: event.eventId,
      ...(requestId ? { requestId } : {}),
    });

    await requestContextStorage.run({ requestId: requestId ?? event.eventId, ip: '', userAgent: null }, () =>
      runWithTenant(event.tenantId, () =>
        processExpirationJob({ appointmentId }, { findStatusById: deps.findStatusById, stateMachine: deps.stateMachine, logger: jobLogger }),
      ),
    );
  };
};
