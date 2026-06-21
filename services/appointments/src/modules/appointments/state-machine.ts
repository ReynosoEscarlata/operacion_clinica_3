import type { Appointment, AppointmentStatus, EventType, Prisma, PrismaClient } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import { writeOutboxEvent } from '../../lib/outbox.js';

export const VALID_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PAID', 'CANCELLED'],
  PAID: ['REMINDED', 'CANCELLED', 'COMPLETED'],
  REMINDED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const canTransition = (from: AppointmentStatus, to: AppointmentStatus): boolean =>
  VALID_TRANSITIONS[from].includes(to);

const TIMESTAMP_FIELD_BY_STATUS: Partial<Record<AppointmentStatus, string>> = {
  CONFIRMED: 'confirmedAt',
  PAID: 'paidAt',
  REMINDED: 'remindedAt',
  COMPLETED: 'completedAt',
  CANCELLED: 'cancelledAt',
  NO_SHOW: 'noShowAt',
};

export interface TransitionMetadata {
  trigger: string;
  eventType?: EventType;
  cancellationReason?: string;
  eventPayload?: Record<string, unknown>;
  extraData?: Prisma.AppointmentUpdateInput;
}

export interface AppointmentStateMachine {
  canTransition: (from: AppointmentStatus, to: AppointmentStatus) => boolean;
  transition: (
    appointmentId: string,
    to: AppointmentStatus,
    metadata: TransitionMetadata,
  ) => Promise<Appointment>;
}

const runTransition = async (
  tx: Prisma.TransactionClient,
  logger: Logger,
  appointmentId: string,
  to: AppointmentStatus,
  metadata: TransitionMetadata,
): Promise<Appointment> => {
  const current = await tx.appointment.findUnique({ where: { id: appointmentId } });
  if (!current) {
    throw new AppError(404, 'APPOINTMENT_NOT_FOUND', 'Cita no encontrada');
  }

  if (!canTransition(current.status, to)) {
    throw new AppError(
      409,
      'INVALID_STATE_TRANSITION',
      `No se puede transicionar de ${current.status} a ${to}`,
    );
  }

  const timestampField = TIMESTAMP_FIELD_BY_STATUS[to];

  const updated = await tx.appointment.update({
    where: { id: appointmentId },
    data: {
      status: to,
      ...(timestampField ? { [timestampField]: new Date() } : {}),
      ...(metadata.cancellationReason !== undefined
        ? { cancellationReason: metadata.cancellationReason }
        : {}),
      ...metadata.extraData,
    },
  });

  await tx.appointmentEvent.create({
    data: {
      appointmentId,
      type: metadata.eventType ?? 'STATUS_CHANGED',
      payload: { from: current.status, to, trigger: metadata.trigger, ...metadata.eventPayload },
    },
  });

  // AppointmentStatusChanged: consumido por Notifications (decide si envía
  // email, ej. necesita refundAmountCents para el mail de cancelación) y
  // por su propio read-model (RFC-001 decisión 4). Se escribe en la misma
  // transacción que el cambio de estado (ADR-002). Incluye eventPayload
  // (no solo IDs) porque datos como el monto del reembolso solo existen en
  // el momento de la transición — no son redundantes con el read-model.
  await writeOutboxEvent(tx, 'AppointmentStatusChanged', {
    appointmentId,
    from: current.status,
    to,
    trigger: metadata.trigger,
    ...metadata.eventPayload,
  });

  logger.info(
    { appointmentId, from: current.status, to, trigger: metadata.trigger },
    'Cambio de estado de cita',
  );

  return updated;
};

export const buildStateMachine = (prisma: PrismaClient, logger: Logger): AppointmentStateMachine => ({
  canTransition,
  transition: (appointmentId, to, metadata) =>
    prisma.$transaction((tx) => runTransition(tx, logger, appointmentId, to, metadata)),
});
