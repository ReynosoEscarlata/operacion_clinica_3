import type { Appointment } from '@prisma/client';

import type { DoctorsClient } from '../../clients/doctors-client.js';
import type { PaymentsClient } from '../../clients/payments-client.js';
import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import type { PatientRepository } from '../patients/patients.repository.js';
import type {
  AppointmentRepository,
  AppointmentWithEvents,
  ListAppointmentsResult,
} from './appointments.repository.js';
import type { CreateAppointmentDto, ListAppointmentsQueryDto } from './appointments.schemas.js';
import type { AppointmentStateMachine } from './state-machine.js';

export type CancelledBy = 'PATIENT' | 'ADMIN';

export interface CancelAppointmentResult {
  appointment: Appointment;
  refundAmountCents: number;
}

export interface CreateAppointmentResult {
  appointment: Appointment;
  clientSecret: string | null;
}

const FULL_REFUND_THRESHOLD_HOURS = 24;
const PARTIAL_REFUND_RATIO = 0.5;
const SLOT_MINUTES = 30;

const toDateOnly = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export class AppointmentService {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly patientRepository: PatientRepository,
    private readonly doctorsClient: DoctorsClient,
    private readonly stateMachine: AppointmentStateMachine,
    private readonly paymentsClient: PaymentsClient,
    private readonly enqueueExpiration: (appointmentId: string, requestId?: string) => Promise<void>,
    private readonly enqueueReminder: (
      appointmentId: string,
      dateTime: Date,
      requestId?: string,
    ) => Promise<void>,
    private readonly logger: Logger,
  ) {}

  async create(dto: CreateAppointmentDto, requestId?: string): Promise<CreateAppointmentResult> {
    const patient = await this.patientRepository.findById(dto.patientId);
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }

    const doctor = await this.doctorsClient.getDoctor(dto.doctorId);
    if (!doctor) {
      throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor no encontrado');
    }

    const dateTime = new Date(dto.dateTime);
    await this.assertSlotIsBookable(dto.doctorId, dateTime);

    const appointment = await this.repository.createPending({
      patientId: dto.patientId,
      doctorId: dto.doctorId,
      dateTime,
      durationMinutes: SLOT_MINUTES,
    });

    let paymentIntent: { id: string; clientSecret: string | null };
    try {
      paymentIntent = await this.paymentsClient.createPaymentIntent(
        appointment.id,
        doctor.consultationPriceCents,
        patient.stripeCustomerId,
      );
    } catch (error) {
      await this.compensateFailedCreation(appointment.id, error);
      throw error;
    }

    const confirmed = await this.stateMachine.transition(appointment.id, 'CONFIRMED', {
      trigger: 'system',
      eventPayload: { stripePaymentIntentId: paymentIntent.id },
      extraData: {
        stripePaymentIntentId: paymentIntent.id,
        amountCents: doctor.consultationPriceCents,
      },
    });

    await this.enqueueExpiration(appointment.id, requestId);

    return { appointment: confirmed, clientSecret: paymentIntent.clientSecret };
  }

  async getById(id: string): Promise<AppointmentWithEvents> {
    const appointment = await this.repository.findById(id);
    if (!appointment) {
      throw new AppError(404, 'APPOINTMENT_NOT_FOUND', 'Cita no encontrada');
    }
    return appointment;
  }

  async list(query: ListAppointmentsQueryDto): Promise<ListAppointmentsResult> {
    return this.repository.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            dateRange: {
              start: query.dateFrom ? new Date(query.dateFrom) : new Date(0),
              end: query.dateTo ? new Date(query.dateTo) : new Date('9999-12-31'),
            },
          }
        : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      paginate: true,
    });
  }

  async cancel(
    id: string,
    reason: string | undefined,
    cancelledBy: CancelledBy,
  ): Promise<CancelAppointmentResult> {
    const appointment = await this.repository.findById(id);
    if (!appointment) {
      throw new AppError(404, 'APPOINTMENT_NOT_FOUND', 'Cita no encontrada');
    }

    const trigger = cancelledBy === 'ADMIN' ? 'admin' : 'patient';

    switch (appointment.status) {
      case 'PENDING': {
        const updated = await this.stateMachine.transition(id, 'CANCELLED', {
          trigger,
          eventType: 'CANCELLED',
          cancellationReason: reason ?? 'Cancelada antes de pagar',
          eventPayload: { refundAmountCents: 0, cancelledBy },
        });
        return { appointment: updated, refundAmountCents: 0 };
      }

      case 'CONFIRMED': {
        if (appointment.stripePaymentIntentId) {
          await this.paymentsClient.cancelPaymentIntent(appointment.stripePaymentIntentId);
        }
        const updated = await this.stateMachine.transition(id, 'CANCELLED', {
          trigger,
          eventType: 'CANCELLED',
          cancellationReason: reason ?? 'Cancelada antes del cobro',
          eventPayload: { refundAmountCents: 0, cancelledBy },
        });
        return { appointment: updated, refundAmountCents: 0 };
      }

      case 'PAID':
      case 'REMINDED': {
        const hoursUntilAppointment = (appointment.dateTime.getTime() - Date.now()) / 3_600_000;
        const isFullRefund = hoursUntilAppointment >= FULL_REFUND_THRESHOLD_HOURS;
        const refundAmountCents = isFullRefund
          ? appointment.amountCents
          : Math.round(appointment.amountCents * PARTIAL_REFUND_RATIO);

        if (appointment.stripePaymentIntentId) {
          await this.paymentsClient.createRefund(
            appointment.stripePaymentIntentId,
            refundAmountCents,
            appointment.id,
          );
        }

        const updated = await this.stateMachine.transition(id, 'CANCELLED', {
          trigger,
          eventType: 'CANCELLED',
          cancellationReason:
            reason ?? (isFullRefund ? 'Cancelación con reembolso completo' : 'Cancelación con penalización'),
          eventPayload: {
            refundAmountCents,
            refundType: isFullRefund ? 'FULL' : 'PARTIAL',
            cancelledBy,
          },
        });
        return { appointment: updated, refundAmountCents };
      }

      default:
        throw new AppError(
          409,
          'INVALID_STATE_TRANSITION',
          `No se puede cancelar una cita en estado ${appointment.status}`,
        );
    }
  }

  async complete(id: string): Promise<Appointment> {
    return this.stateMachine.transition(id, 'COMPLETED', { trigger: 'admin' });
  }

  async markNoShow(id: string): Promise<Appointment> {
    return this.stateMachine.transition(id, 'NO_SHOW', { trigger: 'admin' });
  }

  // Transiciona CONFIRMED -> PAID y encola el recordatorio (24h antes de la
  // cita), igual que el monolito hace desde payments.service.ts al recibir
  // el webhook payment_intent.succeeded. Invocado por
  // src/lib/event-consumer.ts al consumir PaymentSucceeded (publicado por
  // Payments vía Outbox/Redis Streams — ver server.ts). Es idempotente a
  // nivel de quien la llama: si la cita ya no está en CONFIRMED (evento
  // duplicado o re-entregado), el consumer trata INVALID_STATE_TRANSITION
  // como éxito, no como fallo a reintentar.
  async confirmPayment(id: string, stripePaymentIntentId: string): Promise<Appointment> {
    const updated = await this.stateMachine.transition(id, 'PAID', {
      trigger: 'webhook',
      eventType: 'PAYMENT_RECEIVED',
      eventPayload: { stripePaymentIntentId },
    });

    await this.enqueueReminder(id, updated.dateTime);

    return updated;
  }

  // No transiciona estado (el monolito tampoco lo hace: la cita sigue
  // CONFIRMED, el paciente puede reintentar el pago dentro de la ventana de
  // 30 minutos antes de expirar). Solo registra el intento fallido en el
  // timeline. Invocado por el consumer al recibir PaymentFailed.
  async recordPaymentFailed(id: string, stripePaymentIntentId: string, reason: string | null): Promise<void> {
    await this.repository.addEvent(id, 'PAYMENT_FAILED', { stripePaymentIntentId, reason });
  }

  private async assertSlotIsBookable(doctorId: string, dateTime: Date): Promise<void> {
    if (Number.isNaN(dateTime.getTime())) {
      throw new AppError(400, 'INVALID_DATE', 'La fecha/hora de la cita es inválida');
    }

    if (dateTime.getTime() <= Date.now()) {
      throw new AppError(400, 'PAST_DATE', 'La cita debe ser en una fecha futura');
    }

    if (dateTime.getMinutes() % SLOT_MINUTES !== 0 || dateTime.getSeconds() !== 0) {
      throw new AppError(
        400,
        'INVALID_APPOINTMENT_TIME',
        `La hora de la cita debe alinearse a bloques de ${SLOT_MINUTES} minutos`,
      );
    }

    const availableSlots = await this.doctorsClient.getAvailableSlots(doctorId, toDateOnly(dateTime));
    const requestedIso = dateTime.toISOString();

    if (!availableSlots.includes(requestedIso)) {
      throw new AppError(
        409,
        'SLOT_UNAVAILABLE',
        'El horario solicitado no está dentro de la disponibilidad del doctor',
      );
    }
  }

  private async compensateFailedCreation(appointmentId: string, error: unknown): Promise<void> {
    this.logger.error(
      { err: error, appointmentId, operation: 'createPaymentIntent' },
      'Error al crear PaymentIntent en Payments',
    );

    try {
      await this.repository.deleteHard(appointmentId);
    } catch (cleanupError) {
      this.logger.error(
        { err: cleanupError, appointmentId },
        'No se pudo limpiar la cita PENDING tras fallo de Payments',
      );
    }
  }
}

export interface AppointmentServiceDeps {
  repository: AppointmentRepository;
  patientRepository: PatientRepository;
  doctorsClient: DoctorsClient;
  stateMachine: AppointmentStateMachine;
  paymentsClient: PaymentsClient;
  enqueueExpiration: (appointmentId: string, requestId?: string) => Promise<void>;
  enqueueReminder: (appointmentId: string, dateTime: Date, requestId?: string) => Promise<void>;
  logger: Logger;
}

export const buildAppointmentService = (deps: AppointmentServiceDeps): AppointmentService =>
  new AppointmentService(
    deps.repository,
    deps.patientRepository,
    deps.doctorsClient,
    deps.stateMachine,
    deps.paymentsClient,
    deps.enqueueExpiration,
    deps.enqueueReminder,
    deps.logger,
  );
