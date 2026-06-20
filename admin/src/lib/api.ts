import type {
  AppointmentDetail,
  AppointmentDetailResult,
  CancelAppointmentResult,
  DashboardStats,
  DeadLetterListResult,
  Doctor,
  ListAppointmentsResult,
  RecentEvent,
} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

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
  adminKey: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
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

export const fetchAppointments = (adminKey: string, queryString: string): Promise<ListAppointmentsResult> =>
  apiRequest<ListAppointmentsResult>(adminKey, `/api/admin/appointments${queryString}`);

export const fetchAppointmentDetail = (
  adminKey: string,
  id: string,
): Promise<AppointmentDetailResult> => apiRequest<AppointmentDetailResult>(adminKey, `/api/admin/appointments/${id}`);

export const cancelAppointment = (
  adminKey: string,
  id: string,
  reason: string,
): Promise<CancelAppointmentResult> =>
  apiRequest<CancelAppointmentResult>(adminKey, `/api/admin/appointments/${id}/cancel`, {
    method: 'PATCH',
    body: { reason },
  });

export const completeAppointment = (adminKey: string, id: string): Promise<AppointmentDetail> =>
  apiRequest<AppointmentDetail>(adminKey, `/api/admin/appointments/${id}/complete`, { method: 'PATCH' });

export const markAppointmentNoShow = (adminKey: string, id: string): Promise<AppointmentDetail> =>
  apiRequest<AppointmentDetail>(adminKey, `/api/admin/appointments/${id}/no-show`, { method: 'PATCH' });

export const fetchDashboard = (adminKey: string): Promise<DashboardStats> =>
  apiRequest<DashboardStats>(adminKey, '/api/admin/dashboard');

export const fetchRecentEvents = (adminKey: string, hours = 24): Promise<RecentEvent[]> =>
  apiRequest<RecentEvent[]>(adminKey, `/api/admin/events?hours=${hours}`);

export const fetchDeadLetterJobs = (adminKey: string): Promise<DeadLetterListResult> =>
  apiRequest<DeadLetterListResult>(adminKey, '/api/admin/dead-letter');

export const retryDeadLetterJob = (
  adminKey: string,
  queueName: string,
  jobId: string,
): Promise<{ status: 'ok'; message: string }> =>
  apiRequest(adminKey, `/api/admin/dead-letter/${encodeURIComponent(queueName)}/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  });

export const removeDeadLetterJob = (
  adminKey: string,
  queueName: string,
  jobId: string,
): Promise<{ status: 'ok'; message: string }> =>
  apiRequest(adminKey, `/api/admin/dead-letter/${encodeURIComponent(queueName)}/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });

// Endpoint público (sin auth de admin), usado para poblar el filtro de doctor.
export const fetchDoctors = async (): Promise<Doctor[]> => {
  const response = await fetch(`${BASE_URL}/api/doctors`);
  if (!response.ok) {
    throw new ApiError(response.status, 'DOCTORS_FETCH_FAILED', 'No se pudo cargar la lista de doctores');
  }
  return response.json() as Promise<Doctor[]>;
};
