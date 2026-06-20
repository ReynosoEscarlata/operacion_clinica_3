import { ApiError } from './api';
import type { CreateAppointmentResult, Doctor, Patient, Slot } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

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
  publicRequest<Patient>('/api/patients', { method: 'POST', body: data });

export const findPatientByEmail = (email: string): Promise<Patient> =>
  publicRequest<Patient>(`/api/patients/by-email?email=${encodeURIComponent(email)}`);

export const getPatientById = (id: string): Promise<Patient> =>
  publicRequest<Patient>(`/api/patients/${id}`);

export const listDoctorsPublic = (): Promise<Doctor[]> => publicRequest<Doctor[]>('/api/doctors');

export const getDoctorSlots = (doctorId: string, date: string): Promise<Slot[]> =>
  publicRequest<Slot[]>(`/api/doctors/${doctorId}/slots?date=${date}`);

export const createAppointment = (data: {
  patientId: string;
  doctorId: string;
  dateTime: string;
}): Promise<CreateAppointmentResult> =>
  publicRequest<CreateAppointmentResult>('/api/appointments', { method: 'POST', body: data });

export { ApiError };
