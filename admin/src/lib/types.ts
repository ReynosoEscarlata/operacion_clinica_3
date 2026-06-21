export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PAID'
  | 'REMINDED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface AppointmentListItem {
  id: string;
  patientId: string;
  doctorId: string;
  dateTime: string;
  durationMinutes: number;
  amountCents: number;
  status: AppointmentStatus;
  cancellationReason: string | null;
  stripePaymentIntentId: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  remindedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Appointments no tiene datos de Doctors (RFC-001 decisión 5: cero
  // estado compartido) — solo el id. El nombre se resuelve en el cliente
  // contra la lista de doctores que ya se pide para el filtro.
  patient: { id: string; name: string };
}

export interface ListAppointmentsResult {
  items: AppointmentListItem[];
  nextCursor: string | null;
}

export interface Patient {
  id: string;
  email: string;
  name: string;
  phone: string;
  stripeCustomerId: string | null;
}

export interface Doctor {
  id: string;
  name: string;
  email: string;
  specialty: string;
  consultationPriceCents: number;
}

export interface AppointmentEvent {
  id: string;
  appointmentId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AppointmentDetail {
  id: string;
  patientId: string;
  doctorId: string;
  dateTime: string;
  durationMinutes: number;
  amountCents: number;
  status: AppointmentStatus;
  cancellationReason: string | null;
  stripePaymentIntentId: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  remindedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
  createdAt: string;
  updatedAt: string;
  patient: Patient;
  events: AppointmentEvent[];
}

export interface StripePaymentInfo {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export interface AppointmentDetailResult {
  appointment: AppointmentDetail;
  stripePayment: StripePaymentInfo | null;
}

export interface CancelAppointmentResult {
  appointment: AppointmentDetail | AppointmentListItem;
  refundAmountCents: number;
}

export interface DashboardStats {
  appointmentsToday: number;
  appointmentsThisWeek: number;
  byStatus: Record<AppointmentStatus, number>;
  revenue: { today: number; thisWeek: number; thisMonth: number };
  noShowRateByDoctor: Array<{
    doctorId: string;
    noShowCount: number;
    completedCount: number;
    rate: number;
  }>;
}

export interface RecentEvent {
  id: string;
  appointmentId: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

// "source" distingue de qué servicio vino la entrada — Appointments y
// Notifications tienen cada uno su propia tabla de dead-letter (RFC-002:
// no hay agregador, el panel pega a los dos por separado).
export type DeadLetterSource = 'appointments' | 'notifications';

export interface DeadLetterJob {
  id: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  error: string;
  attempts: number;
  failedAt: string;
  source: DeadLetterSource;
}

export interface DeadLetterListResult {
  status: 'ok';
  data: DeadLetterJob[];
  count: number;
}

// --- Tipos del flujo público (registro + reserva) ---

export interface Slot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface CreateAppointmentResult {
  appointment: AppointmentListItem;
  clientSecret: string | null;
}
