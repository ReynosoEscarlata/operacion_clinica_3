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
  patient: { id: string; name: string };
  doctor: { id: string; name: string };
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
  doctor: Doctor;
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
    doctorName: string;
    noShowCount: number;
    completedCount: number;
    rate: number;
  }>;
}

export interface RecentEvent {
  id: string;
  appointmentId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  appointment: {
    id: string;
    patient: { name: string };
    doctor: { name: string };
  };
}

export interface DeadLetterJob {
  id: string;
  queueName: string;
  jobName: string;
  data: Record<string, unknown>;
  failedReason: string;
  attemptsMade: number;
  timestamp: string;
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
