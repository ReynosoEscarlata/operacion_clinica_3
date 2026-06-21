import type {
  AppointmentDetail,
  AppointmentDetailResult,
  CancelAppointmentResult,
  DashboardStats,
  DeadLetterJob,
  DeadLetterListResult,
  DeadLetterSource,
  Doctor,
  ListAppointmentsResult,
  RecentEvent,
} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export const apiRequest = async <T>(
  accessToken: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const envelope = (data ?? {}) as ErrorEnvelope;
    throw new ApiError(
      response.status,
      envelope.error?.code ?? 'UNKNOWN_ERROR',
      envelope.error?.message ?? 'Ocurrió un error inesperado',
    );
  }

  return data as T;
};

// Lista/detalle/acciones de citas viven en Appointments (RFC-002): el
// gateway proxea /v1/appointments/* ahí directo, sin /api/admin de por medio.
export const fetchAppointments = (accessToken: string, queryString: string): Promise<ListAppointmentsResult> =>
  apiRequest<ListAppointmentsResult>(accessToken, `/v1/appointments${queryString}`);

export const fetchAppointmentDetail = async (
  accessToken: string,
  id: string,
): Promise<AppointmentDetailResult> => {
  const appointment = await apiRequest<AppointmentDetail>(accessToken, `/v1/appointments/${id}`);
  // Payments todavía no expone una consulta de solo lectura del
  // PaymentIntent (gap documentado en RFC-002) — queda null hasta que se
  // agregue ese endpoint.
  return { appointment, stripePayment: null };
};

export const cancelAppointment = (
  accessToken: string,
  id: string,
  reason: string,
): Promise<CancelAppointmentResult> =>
  apiRequest<CancelAppointmentResult>(accessToken, `/v1/appointments/${id}/cancel`, {
    method: 'PATCH',
    body: { reason },
  });

export const completeAppointment = (accessToken: string, id: string): Promise<AppointmentDetail> =>
  apiRequest<AppointmentDetail>(accessToken, `/v1/appointments/${id}/complete`, { method: 'PATCH' });

export const markAppointmentNoShow = (accessToken: string, id: string): Promise<AppointmentDetail> =>
  apiRequest<AppointmentDetail>(accessToken, `/v1/appointments/${id}/no-show`, { method: 'PATCH' });

// Dashboard/eventos viven en Appointments (RFC-002, opción 1: cada
// servicio dueño de sus datos, sin agregador nuevo).
export const fetchDashboard = (accessToken: string): Promise<DashboardStats> =>
  apiRequest<DashboardStats>(accessToken, '/v1/admin/dashboard');

export const fetchRecentEvents = (accessToken: string, hours = 24): Promise<RecentEvent[]> =>
  apiRequest<RecentEvent[]>(accessToken, `/v1/admin/events?hours=${hours}`);

// Dead-letter NO tiene agregador (RFC-002): Appointments y Notifications
// tienen cada uno su propia tabla, el panel pega a los dos por separado y
// los junta en una sola lista marcando el origen de cada entrada.
const DEAD_LETTER_ENDPOINT: Record<DeadLetterSource, string> = {
  appointments: '/v1/admin/dead-letter',
  notifications: '/v1/dead-letter',
};

export const fetchDeadLetterJobs = async (accessToken: string): Promise<DeadLetterListResult> => {
  const [appointments, notifications] = await Promise.all([
    apiRequest<{ data: Omit<DeadLetterJob, 'source'>[] }>(accessToken, DEAD_LETTER_ENDPOINT.appointments),
    apiRequest<{ data: Omit<DeadLetterJob, 'source'>[] }>(accessToken, DEAD_LETTER_ENDPOINT.notifications),
  ]);

  const data: DeadLetterJob[] = [
    ...appointments.data.map((row) => ({ ...row, source: 'appointments' as const })),
    ...notifications.data.map((row) => ({ ...row, source: 'notifications' as const })),
  ];

  return { status: 'ok', data, count: data.length };
};

export const retryDeadLetterJob = (
  accessToken: string,
  source: DeadLetterSource,
  id: string,
): Promise<{ status: 'ok'; message: string }> =>
  apiRequest(accessToken, `${DEAD_LETTER_ENDPOINT[source]}/${id}/retry`, { method: 'POST' });

export const removeDeadLetterJob = (
  accessToken: string,
  source: DeadLetterSource,
  id: string,
): Promise<{ status: 'ok'; message: string }> =>
  apiRequest(accessToken, `${DEAD_LETTER_ENDPOINT[source]}/${id}`, { method: 'DELETE' });

// Endpoint público (sin auth de admin), usado para poblar el filtro de doctor.
// El servicio de Doctors envuelve la lista en { data: [...] } (no un array
// plano) — ver doctors.controller.ts:listAll.
export const fetchDoctors = async (): Promise<Doctor[]> => {
  const response = await fetch(`${BASE_URL}/v1/doctors`);
  if (!response.ok) {
    throw new ApiError(response.status, 'DOCTORS_FETCH_FAILED', 'No se pudo cargar la lista de doctores');
  }
  const { data } = (await response.json()) as { data: Doctor[] };
  return data;
};

// Una sola consulta de detalle (no una lista) — sync HTTP a Doctors está
// sancionado por ADR-001 para este caso, a diferencia de listas donde
// sería N+1.
export const fetchDoctorById = async (id: string): Promise<Doctor | null> => {
  const response = await fetch(`${BASE_URL}/v1/doctors/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError(response.status, 'DOCTOR_FETCH_FAILED', 'No se pudo cargar el doctor');
  }
  return response.json() as Promise<Doctor>;
};
