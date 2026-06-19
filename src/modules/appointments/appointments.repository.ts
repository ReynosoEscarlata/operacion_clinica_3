import type {
  Appointment,
  AppointmentEvent,
  AppointmentStatus,
  EventType,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { AppError } from '../../lib/app-error.js';

export interface CreateAppointmentData {
  patientId: string;
  doctorId: string;
  dateTime: Date;
  durationMinutes: number;
}

export interface ListAppointmentsFilters {
  status?: AppointmentStatus;
  doctorId?: string;
  patientId?: string;
  dateRange?: { start: Date; end: Date };
}

export type AppointmentWithEvents = Appointment & { events: AppointmentEvent[] };

export interface AppointmentRepository {
  createPending: (data: CreateAppointmentData) => Promise<Appointment>;
  findById: (id: string) => Promise<AppointmentWithEvents | null>;
  findStatusById: (id: string) => Promise<AppointmentStatus | null>;
  findByPaymentIntentId: (stripePaymentIntentId: string) => Promise<Appointment | null>;
  list: (filters: ListAppointmentsFilters) => Promise<Appointment[]>;
  deleteHard: (id: string) => Promise<void>;
  addEvent: (appointmentId: string, type: EventType, payload: Prisma.InputJsonObject) => Promise<void>;
}

const MAX_LIST_RESULTS = 200;

// Código de Prisma para "Transaction failed due to a write conflict or a
// deadlock" (SQLSTATE 40001 de Postgres). Bajo aislamiento Serializable, dos
// inserts concurrentes para el mismo slot hacen que uno de los dos aborte
// con este código — así se detecta el conflicto sin necesitar un constraint
// único que bloquearía re-reservar un slot ya cancelado.
const SERIALIZATION_FAILURE_CODE = 'P2034';

const isSerializationFailure = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === SERIALIZATION_FAILURE_CODE;

export class PrismaAppointmentRepository implements AppointmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPending(data: CreateAppointmentData): Promise<Appointment> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const conflicting = await tx.appointment.findFirst({
            where: {
              doctorId: data.doctorId,
              dateTime: data.dateTime,
              status: { not: 'CANCELLED' },
            },
          });

          if (conflicting) {
            throw new AppError(409, 'SLOT_UNAVAILABLE', 'El horario ya no está disponible');
          }

          const appointment = await tx.appointment.create({ data });

          await tx.appointmentEvent.create({
            data: {
              appointmentId: appointment.id,
              type: 'CREATED',
              payload: { patientId: data.patientId, doctorId: data.doctorId },
            },
          });

          return appointment;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (isSerializationFailure(error)) {
        throw new AppError(409, 'SLOT_UNAVAILABLE', 'El horario ya no está disponible');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<AppointmentWithEvents | null> {
    return this.prisma.appointment.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async findStatusById(id: string): Promise<AppointmentStatus | null> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: { status: true },
    });
    return appointment?.status ?? null;
  }

  async findByPaymentIntentId(stripePaymentIntentId: string): Promise<Appointment | null> {
    return this.prisma.appointment.findUnique({ where: { stripePaymentIntentId } });
  }

  async list(filters: ListAppointmentsFilters): Promise<Appointment[]> {
    const where: Prisma.AppointmentWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.doctorId ? { doctorId: filters.doctorId } : {}),
      ...(filters.patientId ? { patientId: filters.patientId } : {}),
      ...(filters.dateRange ? { dateTime: { gte: filters.dateRange.start, lt: filters.dateRange.end } } : {}),
    };

    return this.prisma.appointment.findMany({
      where,
      orderBy: { dateTime: 'desc' },
      take: MAX_LIST_RESULTS,
    });
  }

  async deleteHard(id: string): Promise<void> {
    await this.prisma.appointment.delete({ where: { id } });
  }

  async addEvent(
    appointmentId: string,
    type: EventType,
    payload: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.appointmentEvent.create({ data: { appointmentId, type, payload } });
  }
}

export const buildAppointmentRepository = (prisma: PrismaClient): AppointmentRepository =>
  new PrismaAppointmentRepository(prisma);
