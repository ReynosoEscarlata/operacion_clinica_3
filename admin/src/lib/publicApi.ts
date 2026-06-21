import { ApiError } from './api';
import type { CreateAppointmentResult, Doctor, Patient, Slot } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

interface RequestOptions {
  method?: string;
  body?: unknown;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

// Cliente separado del de admin: estos endpoints son públicos, no llevan
// header x-admin-key (no existe noción de sesión/login de paciente).
const publicRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
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

export const createPatient = (data: { email: string; name: string; phone: string }): Promise<Patient> =>
  publicRequest<Patient>('/v1/patients', { method: 'POST', body: data });

export const findPatientByEmail = (email: string): Promise<Patient> =>
  publicRequest<Patient>(`/v1/patients/by-email?email=${encodeURIComponent(email)}`);

export const getPatientById = (id: string): Promise<Patient> =>
  publicRequest<Patient>(`/v1/patients/${id}`);

// Igual que fetchDoctors en api.ts: la lista viene envuelta en { data: [...] }.
export const listDoctorsPublic = async (): Promise<Doctor[]> => {
  const { data } = await publicRequest<{ data: Doctor[] }>('/v1/doctors');
  return data;
};

// El servicio de Doctors (Challenge 4) no conoce las reservas de Appointments
// (RFC-001 decisión 5: cero estado compartido) y devuelve solo los horarios
// que SÍ están dentro de su disponibilidad configurada — un array de
// datetimes ISO, no el `{startTime,endTime,available}` del monolito (que
// mezclaba disponibilidad + choques de horario en una sola respuesta). Se
// adapta acá para no tener que tocar la UI de BookingPage, que ya asume esa
// forma; cada slot dura 30 minutos (mismo valor que usa Appointments).
const SLOT_DURATION_MINUTES = 30;

const toLocalTime = (isoDateTime: string): string => {
  const date = new Date(isoDateTime);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export const getDoctorSlots = async (doctorId: string, date: string): Promise<Slot[]> => {
  const { slots } = await publicRequest<{ slots: string[] }>(`/v1/doctors/${doctorId}/slots?date=${date}`);
  return slots.map((isoDateTime) => {
    const end = new Date(new Date(isoDateTime).getTime() + SLOT_DURATION_MINUTES * 60_000).toISOString();
    return { startTime: toLocalTime(isoDateTime), endTime: toLocalTime(end), available: true };
  });
};

export const createAppointment = (data: {
  patientId: string;
  doctorId: string;
  dateTime: string;
}): Promise<CreateAppointmentResult> =>
  publicRequest<CreateAppointmentResult>('/v1/appointments', { method: 'POST', body: data });

export { ApiError };
