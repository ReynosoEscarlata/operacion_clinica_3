import type { Appointment } from '@prisma/client';

import { Sentry } from '../../config/sentry.js';
import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import type { DoctorRepository } from '../doctors/doctors.repository.js';
import { parseTimeToMinutes, SLOT_MINUTES } from '../doctors/slots.js';
import type { PatientRepository } from '../patients/patients.repository.js';
import type { AppointmentRepository, AppointmentWithEvents } from './appointments.repository.js';
import type {
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
} from './appointments.schemas.js';
import type { AppointmentStateMachine } from './state-machine.js';

export interface StripeAppointmentsClient {
  paymentIntents: {
    create: (params: {
      amount: number;
      currency: string;
      customer?: string;
      metadata: Record<string, string>;
    }) => Promise<{ id: string; client_secret: string | null }>;
    cancel: (paymentIntentId: string) => Promise<unknown>;
  };
  refunds: {
    create: (params: { payment_intent: string; amount?: number }) => Promise<{ id: string }>;
  };
}

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

export class AppointmentService {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly patientRepository: PatientRepository,
    private readonly doctorRepository: DoctorRepository,
    private readonly stateMachine: AppointmentStateMachine,
    private readonly stripeClient: StripeAppointmentsClient,
    private readonly enqueueExpiration: (appointmentId: string, requestId?: string) => Promise<void>,
    private readonly logger: Logger,
  ) {}

  async create(dto: CreateAppointmentDto, requestId?: string): Promise<CreateAppointmentResult> {
    const patient = await this.patientRepository.findById(dto.patientId);
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }

    const doctor = await this.doctorRepository.findBasicById(dto.doctorId);
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

    let paymentIntent: { id: string; client_secret: string | null };
    try {
      paymentIntent = await this.stripeClient.paymentIntents.create({
        amount: doctor.consultationPriceCents,
        currency: 'mxn',
        ...(patient.stripeCustomerId ? { customer: patient.stripeCustomerId } : {}),
        metadata: { appointmentId: appointment.id },
      });
    } catch (error) {
      await this.compensateFailedCreation(appointment.id, error);
      throw new AppError(503, 'STRIPE_UNAVAILABLE', 'Servicio de pago no disponible');
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

    return { appointment: confirmed, clientSecret: paymentIntent.client_secret };
  }

  async getById(id: string): Promise<AppointmentWithEvents> {
    const appointment = await this.repository.findById(id);
    if (!appointment) {
      throw new AppError(404, 'APPOINTMENT_NOT_FOUND', 'Cita no encontrada');
    }
    return appointment;
  }

  async list(query: ListAppointmentsQueryDto): Promise<Appointment[]> {
    return this.repository.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.date ? { dateRange: parseDateRange(query.date) } : {}),
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
          await this.cancelPaymentIntentSafely(appointment.stripePaymentIntentId);
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
          await this.refundSafely(appointment.stripePaymentIntentId, refundAmountCents);
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

    const dayOfWeek = dateTime.getDay();
    const availability = await this.doctorRepository.findAvailabilityForDay(doctorId, dayOfWeek);
    const requestedMinutes = dateTime.getHours() * 60 + dateTime.getMinutes();

    const withinAvailability = availability.some((block) => {
      const start = parseTimeToMinutes(block.startTime);
      const end = parseTimeToMinutes(block.endTime);
      return requestedMinutes >= start && requestedMinutes + SLOT_MINUTES <= end;
    });

    if (!withinAvailability) {
      throw new AppError(
        409,
        'SLOT_UNAVAILABLE',
        'El horario solicitado no está dentro de la disponibilidad del doctor',
      );
    }
  }

  private async compensateFailedCreation(appointmentId: string, stripeError: unknown): Promise<void> {
    this.logger.error(
      { err: stripeError, appointmentId, operation: 'createPaymentIntent' },
      'Error al crear PaymentIntent en Stripe',
    );
    Sentry.captureException(stripeError, { extra: { appointmentId } });

    try {
      await this.repository.deleteHard(appointmentId);
    } catch (cleanupError) {
      this.logger.error(
        { err: cleanupError, appointmentId },
        'No se pudo limpiar la cita PENDING tras fallo de Stripe',
      );
      Sentry.captureException(cleanupError, { extra: { appointmentId } });
    }
  }

  private async cancelPaymentIntentSafely(stripePaymentIntentId: string): Promise<void> {
    try {
      await this.stripeClient.paymentIntents.cancel(stripePaymentIntentId);
    } catch (error) {
      this.logger.error(
        { err: error, stripePaymentIntentId, operation: 'cancelPaymentIntent' },
        'Error al cancelar PaymentIntent en Stripe',
      );
      Sentry.captureException(error, { extra: { stripePaymentIntentId } });
      throw new AppError(502, 'STRIPE_UNAVAILABLE', 'Servicio de pago no disponible');
    }
  }

  private async refundSafely(stripePaymentIntentId: string, amountCents: number): Promise<void> {
    try {
      await this.stripeClient.refunds.create({
        payment_intent: stripePaymentIntentId,
        amount: amountCents,
      });
    } catch (error) {
      this.logger.error(
        { err: error, stripePaymentIntentId, amountCents, operation: 'createRefund' },
        'Error al procesar el reembolso en Stripe',
      );
      Sentry.captureException(error, { extra: { stripePaymentIntentId, amountCents } });
      throw new AppError(502, 'STRIPE_REFUND_FAILED', 'No se pudo procesar el reembolso, contacte a soporte');
    }
  }
}

const parseDateRange = (dateStr: string): { start: Date; end: Date } => {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  return { start, end };
};

export interface AppointmentServiceDeps {
  repository: AppointmentRepository;
  patientRepository: PatientRepository;
  doctorRepository: DoctorRepository;
  stateMachine: AppointmentStateMachine;
  stripeClient: StripeAppointmentsClient;
  enqueueExpiration: (appointmentId: string, requestId?: string) => Promise<void>;
  logger: Logger;
}

export const buildAppointmentService = (deps: AppointmentServiceDeps): AppointmentService =>
  new AppointmentService(
    deps.repository,
    deps.patientRepository,
    deps.doctorRepository,
    deps.stateMachine,
    deps.stripeClient,
    deps.enqueueExpiration,
    deps.logger,
  );
