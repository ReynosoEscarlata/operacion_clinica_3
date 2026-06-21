import type {
  Appointment,
  AppointmentEvent,
  AppointmentStatus,
  EventType,
  Patient,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { writeOutboxEvent } from '../../lib/outbox.js';

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
  cursor?: string;
  // Las consultas internas (ej. el worker de no-show, que quiere "todas las
  // que matchean") no paginan y conservan el tope viejo MAX_LIST_RESULTS;
  // el endpoint admin sí pagina por cursor. Flag explícito en vez de
  // inferirlo de la presencia de `cursor` (la primera página no tiene
  // cursor pero igual debe paginar).
  paginate?: boolean;
}

export type AppointmentWithEvents = Appointment & { events: AppointmentEvent[]; patient: Patient };
export type AppointmentWithPatient = Appointment & { patient: Patient };

export interface ListAppointmentsResult {
  items: AppointmentWithPatient[];
  nextCursor: string | null;
}

export interface DashboardStats {
  appointmentsToday: number;
  appointmentsThisWeek: number;
  byStatus: Record<AppointmentStatus, number>;
  revenue: { today: number; thisWeek: number; thisMonth: number };
  noShowRateByDoctor: Array<{ doctorId: string; noShowCount: number; completedCount: number; rate: number }>;
}

export interface AppointmentRepository {
  createPending: (data: CreateAppointmentData) => Promise<Appointment>;
  findById: (id: string) => Promise<AppointmentWithEvents | null>;
  findStatusById: (id: string) => Promise<AppointmentStatus | null>;
  findByPaymentIntentId: (stripePaymentIntentId: string) => Promise<Appointment | null>;
  list: (filters: ListAppointmentsFilters) => Promise<ListAppointmentsResult>;
  deleteHard: (id: string) => Promise<void>;
  addEvent: (appointmentId: string, type: EventType, payload: Prisma.InputJsonObject) => Promise<void>;
  getDashboardStats: () => Promise<DashboardStats>;
  listRecentEvents: (hours: number) => Promise<Array<AppointmentEvent & { appointment: Appointment }>>;
}

const MAX_LIST_RESULTS = 200;
const PAGE_SIZE = 50;
const REVENUE_STATUSES: AppointmentStatus[] = ['PAID', 'REMINDED', 'COMPLETED'];
const ALL_STATUSES: AppointmentStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PAID',
  'REMINDED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

// Código de Prisma para "Transaction failed due to a write conflict or a
// deadlock" (SQLSTATE 40001 de Postgres). Ver appointments.repository.ts
// del monolito: bajo aislamiento Serializable, dos inserts concurrentes
// para el mismo slot hacen que uno aborte con este código.
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

          // AppointmentCreated en la misma transacción que la cita
          // (PLAN.md Fase 2 paso 2, explícito; ver ADR-002).
          await writeOutboxEvent(tx, 'AppointmentCreated', {
            appointmentId: appointment.id,
            patientId: data.patientId,
            doctorId: data.doctorId,
            dateTime: data.dateTime.toISOString(),
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
      include: { events: { orderBy: { createdAt: 'asc' } }, patient: true },
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

  async list(filters: ListAppointmentsFilters): Promise<ListAppointmentsResult> {
    const where: Prisma.AppointmentWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.doctorId ? { doctorId: filters.doctorId } : {}),
      ...(filters.patientId ? { patientId: filters.patientId } : {}),
      ...(filters.dateRange ? { dateTime: { gte: filters.dateRange.start, lt: filters.dateRange.end } } : {}),
    };

    // Paginación por cursor (no offset): se pide una página de más
    // (PAGE_SIZE + 1) para saber si hay siguiente sin un COUNT(*) extra.
    const isPaginatedQuery = filters.paginate === true;
    const take = isPaginatedQuery ? PAGE_SIZE + 1 : MAX_LIST_RESULTS;

    const rows = await this.prisma.appointment.findMany({
      where,
      orderBy: [{ dateTime: 'desc' }, { id: 'desc' }],
      take,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      include: { patient: true },
    });

    if (!isPaginatedQuery || rows.length <= PAGE_SIZE) {
      return { items: rows, nextCursor: null };
    }

    const items = rows.slice(0, PAGE_SIZE);
    return { items, nextCursor: items[items.length - 1]?.id ?? null };
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday.getTime() - startOfToday.getDay() * 86_400_000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [appointmentsToday, appointmentsThisWeek, statusCounts, revenueToday, revenueThisWeek, revenueThisMonth, byDoctor] =
      await Promise.all([
        this.prisma.appointment.count({ where: { dateTime: { gte: startOfToday } } }),
        this.prisma.appointment.count({ where: { dateTime: { gte: startOfWeek } } }),
        this.prisma.appointment.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.appointment.aggregate({
          _sum: { amountCents: true },
          where: { status: { in: REVENUE_STATUSES }, paidAt: { gte: startOfToday } },
        }),
        this.prisma.appointment.aggregate({
          _sum: { amountCents: true },
          where: { status: { in: REVENUE_STATUSES }, paidAt: { gte: startOfWeek } },
        }),
        this.prisma.appointment.aggregate({
          _sum: { amountCents: true },
          where: { status: { in: REVENUE_STATUSES }, paidAt: { gte: startOfMonth } },
        }),
        this.prisma.appointment.groupBy({
          by: ['doctorId', 'status'],
          _count: { _all: true },
          where: { status: { in: ['NO_SHOW', 'COMPLETED'] } },
        }),
      ]);

    const byStatus = ALL_STATUSES.reduce(
      (acc, status) => {
        acc[status] = statusCounts.find((row) => row.status === status)?._count._all ?? 0;
        return acc;
      },
      {} as Record<AppointmentStatus, number>,
    );

    const byDoctorMap = new Map<string, { noShowCount: number; completedCount: number }>();
    for (const row of byDoctor) {
      const entry = byDoctorMap.get(row.doctorId) ?? { noShowCount: 0, completedCount: 0 };
      if (row.status === 'NO_SHOW') entry.noShowCount = row._count._all;
      if (row.status === 'COMPLETED') entry.completedCount = row._count._all;
      byDoctorMap.set(row.doctorId, entry);
    }

    const noShowRateByDoctor = Array.from(byDoctorMap.entries()).map(([doctorId, counts]) => {
      const total = counts.noShowCount + counts.completedCount;
      return { doctorId, ...counts, rate: total === 0 ? 0 : counts.noShowCount / total };
    });

    return {
      appointmentsToday,
      appointmentsThisWeek,
      byStatus,
      revenue: {
        today: revenueToday._sum.amountCents ?? 0,
        thisWeek: revenueThisWeek._sum.amountCents ?? 0,
        thisMonth: revenueThisMonth._sum.amountCents ?? 0,
      },
      noShowRateByDoctor,
    };
  }

  async listRecentEvents(hours: number): Promise<Array<AppointmentEvent & { appointment: Appointment }>> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.prisma.appointmentEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: MAX_LIST_RESULTS,
      include: { appointment: true },
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
