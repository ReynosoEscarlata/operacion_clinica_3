import type {
  Appointment,
  AppointmentEvent,
  AppointmentStatus,
  Doctor,
  Patient,
  Prisma,
  PrismaClient,
} from '@prisma/client';

export interface AdminListAppointmentsFilters {
  status?: AppointmentStatus;
  doctorId?: string;
  patientId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  cursor?: string;
  limit: number;
}

export type AdminAppointmentListItem = Appointment & {
  patient: Pick<Patient, 'id' | 'name'>;
  doctor: Pick<Doctor, 'id' | 'name'>;
};

export type AdminAppointmentDetail = Appointment & {
  patient: Patient;
  doctor: Doctor;
  events: AppointmentEvent[];
};

export interface RevenueStats {
  today: number;
  thisWeek: number;
  thisMonth: number;
}

export interface NoShowRateByDoctor {
  doctorId: string;
  doctorName: string;
  noShowCount: number;
  completedCount: number;
  rate: number;
}

export interface DashboardStats {
  appointmentsToday: number;
  appointmentsThisWeek: number;
  byStatus: Record<AppointmentStatus, number>;
  revenue: RevenueStats;
  noShowRateByDoctor: NoShowRateByDoctor[];
}

export type AdminRecentEvent = AppointmentEvent & {
  appointment: {
    id: string;
    patient: Pick<Patient, 'name'>;
    doctor: Pick<Doctor, 'name'>;
  };
};

export interface AdminAppointmentsRepository {
  list: (filters: AdminListAppointmentsFilters) => Promise<AdminAppointmentListItem[]>;
  findDetailById: (id: string) => Promise<AdminAppointmentDetail | null>;
  getDashboardStats: () => Promise<DashboardStats>;
  getRecentEvents: (since: Date, limit: number) => Promise<AdminRecentEvent[]>;
}

const ALL_STATUSES: AppointmentStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PAID',
  'REMINDED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

const startOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// Semana de lunes a domingo, consistente con la convención de dayOfWeek
// usada en Availability (getDay(): 0=domingo..6=sábado).
const startOfWeek = (date: Date): Date => {
  const start = startOfDay(date);
  const offsetFromMonday = (start.getDay() + 6) % 7;
  return addDays(start, -offsetFromMonday);
};

const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);

export class PrismaAdminAppointmentsRepository implements AdminAppointmentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(filters: AdminListAppointmentsFilters): Promise<AdminAppointmentListItem[]> {
    const where: Prisma.AppointmentWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.doctorId ? { doctorId: filters.doctorId } : {}),
      ...(filters.patientId ? { patientId: filters.patientId } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            dateTime: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lt: filters.dateTo } : {}),
            },
          }
        : {}),
    };

    return this.prisma.appointment.findMany({
      where,
      take: filters.limit,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
      orderBy: { dateTime: 'desc' },
      include: {
        patient: { select: { id: true, name: true } },
        doctor: { select: { id: true, name: true } },
      },
    });
  }

  async findDetailById(id: string): Promise<AdminAppointmentDetail | null> {
    return this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: true,
        doctor: true,
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const weekStart = startOfWeek(now);
    const nextWeekStart = addDays(weekStart, 7);
    const monthStart = startOfMonth(now);

    const [appointmentsToday, appointmentsThisWeek, byStatusRaw, revenueToday, revenueThisWeek, revenueThisMonth, noShowGroups, doctors] =
      await Promise.all([
        this.prisma.appointment.count({ where: { dateTime: { gte: todayStart, lt: tomorrowStart } } }),
        this.prisma.appointment.count({ where: { dateTime: { gte: weekStart, lt: nextWeekStart } } }),
        this.prisma.appointment.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.appointment.aggregate({
          where: { paidAt: { gte: todayStart, lt: tomorrowStart } },
          _sum: { amountCents: true },
        }),
        this.prisma.appointment.aggregate({
          where: { paidAt: { gte: weekStart, lt: nextWeekStart } },
          _sum: { amountCents: true },
        }),
        this.prisma.appointment.aggregate({
          where: { paidAt: { gte: monthStart } },
          _sum: { amountCents: true },
        }),
        this.prisma.appointment.groupBy({
          by: ['doctorId', 'status'],
          where: { status: { in: ['NO_SHOW', 'COMPLETED'] } },
          _count: { _all: true },
        }),
        this.prisma.doctor.findMany({ select: { id: true, name: true } }),
      ]);

    const byStatus = ALL_STATUSES.reduce<Record<AppointmentStatus, number>>((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {} as Record<AppointmentStatus, number>);
    for (const group of byStatusRaw) {
      byStatus[group.status] = group._count._all;
    }

    const doctorNameById = new Map(doctors.map((doctor) => [doctor.id, doctor.name]));
    const countsByDoctor = new Map<string, { noShowCount: number; completedCount: number }>();
    for (const group of noShowGroups) {
      const current = countsByDoctor.get(group.doctorId) ?? { noShowCount: 0, completedCount: 0 };
      if (group.status === 'NO_SHOW') {
        current.noShowCount = group._count._all;
      } else if (group.status === 'COMPLETED') {
        current.completedCount = group._count._all;
      }
      countsByDoctor.set(group.doctorId, current);
    }

    const noShowRateByDoctor: NoShowRateByDoctor[] = Array.from(countsByDoctor.entries()).map(
      ([doctorId, counts]) => {
        const denominator = counts.noShowCount + counts.completedCount;
        return {
          doctorId,
          doctorName: doctorNameById.get(doctorId) ?? 'Doctor desconocido',
          noShowCount: counts.noShowCount,
          completedCount: counts.completedCount,
          rate: denominator === 0 ? 0 : counts.noShowCount / denominator,
        };
      },
    );

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

  async getRecentEvents(since: Date, limit: number): Promise<AdminRecentEvent[]> {
    return this.prisma.appointmentEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        appointment: {
          select: {
            id: true,
            patient: { select: { name: true } },
            doctor: { select: { name: true } },
          },
        },
      },
    });
  }
}

export const buildAdminAppointmentsRepository = (prisma: PrismaClient): AdminAppointmentsRepository =>
  new PrismaAdminAppointmentsRepository(prisma);
