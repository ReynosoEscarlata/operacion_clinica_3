import type { Appointment } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import type { AppointmentService, CancelAppointmentResult } from '../appointments/appointments.service.js';
import type {
  AdminAppointmentDetail,
  AdminAppointmentListItem,
  AdminAppointmentsRepository,
  AdminRecentEvent,
  DashboardStats,
} from './admin-appointments.repository.js';
import type { AdminListAppointmentsQueryDto } from './admin-appointments.schemas.js';

export interface StripePaymentInfo {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export interface AdminStripeClient {
  paymentIntents: {
    retrieve: (id: string) => Promise<StripePaymentInfo>;
  };
}

export interface AdminAppointmentDetailResult {
  appointment: AdminAppointmentDetail;
  stripePayment: StripePaymentInfo | null;
}

export interface AdminListAppointmentsResult {
  items: AdminAppointmentListItem[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_EVENTS_WINDOW_HOURS = 24;
const DEFAULT_EVENTS_LIMIT = 200;

const parseDateOnly = (dateStr: string): Date => {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

export class AdminAppointmentsService {
  constructor(
    private readonly repository: AdminAppointmentsRepository,
    private readonly appointmentService: AppointmentService,
    private readonly stripeClient: AdminStripeClient | undefined,
    private readonly logger: Logger,
  ) {}

  async list(query: AdminListAppointmentsQueryDto): Promise<AdminListAppointmentsResult> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const rows = await this.repository.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.dateFrom ? { dateFrom: parseDateOnly(query.dateFrom) } : {}),
      ...(query.dateTo ? { dateTo: parseDateOnly(query.dateTo) } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return { items, nextCursor };
  }

  async getDetail(id: string): Promise<AdminAppointmentDetailResult> {
    const appointment = await this.repository.findDetailById(id);
    if (!appointment) {
      throw new AppError(404, 'APPOINTMENT_NOT_FOUND', 'Cita no encontrada');
    }

    const stripePayment = await this.fetchStripePaymentInfo(appointment);

    return { appointment, stripePayment };
  }

  async cancel(id: string, reason: string): Promise<CancelAppointmentResult> {
    return this.appointmentService.cancel(id, reason, 'ADMIN');
  }

  async complete(id: string): Promise<Appointment> {
    return this.appointmentService.complete(id);
  }

  async markNoShow(id: string): Promise<Appointment> {
    return this.appointmentService.markNoShow(id);
  }

  async getDashboard(): Promise<DashboardStats> {
    return this.repository.getDashboardStats();
  }

  async getRecentEvents(hours = DEFAULT_EVENTS_WINDOW_HOURS, limit = DEFAULT_EVENTS_LIMIT): Promise<AdminRecentEvent[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.repository.getRecentEvents(since, limit);
  }

  private async fetchStripePaymentInfo(appointment: AdminAppointmentDetail): Promise<StripePaymentInfo | null> {
    if (!this.stripeClient || !appointment.stripePaymentIntentId) {
      return null;
    }

    try {
      return await this.stripeClient.paymentIntents.retrieve(appointment.stripePaymentIntentId);
    } catch (error) {
      // Best-effort: si Stripe no responde, la vista de detalle sigue
      // funcionando con los datos locales (no es información crítica).
      this.logger.warn(
        { err: error, appointmentId: appointment.id, stripePaymentIntentId: appointment.stripePaymentIntentId },
        'No se pudo obtener el detalle del PaymentIntent desde Stripe',
      );
      return null;
    }
  }
}

export interface AdminAppointmentsServiceDeps {
  repository: AdminAppointmentsRepository;
  appointmentService: AppointmentService;
  stripeClient?: AdminStripeClient;
  logger: Logger;
}

export const buildAdminAppointmentsService = (deps: AdminAppointmentsServiceDeps): AdminAppointmentsService =>
  new AdminAppointmentsService(deps.repository, deps.appointmentService, deps.stripeClient, deps.logger);
