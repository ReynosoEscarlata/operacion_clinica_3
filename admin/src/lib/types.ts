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

// Fase 6 (ADR-017): dashboard ejecutivo -- agregados CROSS-TENANT (no un
// DashboardStats por tenant como el de arriba). byStatus es Record<string,
// number> (no Record<AppointmentStatus, number>): la función SECURITY
// DEFINER que lo produce (platform_status_counts) solo devuelve las claves
// de estado que efectivamente tienen citas, nunca las 8 completas.
export interface PlatformDashboardStats {
  appointmentsToday: number;
  appointmentsThisWeek: number;
  byStatus: Record<string, number>;
  revenue: { today: number; thisWeek: number; thisMonth: number };
}

export interface PlatformPerServiceMetrics {
  requestCount: number;
  errorCount: number;
  latencyP95Ms: number;
}

export interface PlatformMetricsData {
  aggregate: {
    requestCount: number;
    errorCount: number;
    errorRatePercent: number;
    latencyP95MaxMs: number;
  };
  perService: Record<string, PlatformPerServiceMetrics>;
}

export type PlatformMetricsResult =
  | { available: true; data: PlatformMetricsData }
  | { available: false; reason: string };

export interface PlatformActiveUsers {
  activeByRole: Record<string, number>;
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
