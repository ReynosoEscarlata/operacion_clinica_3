import { AppError } from '../lib/app-error.js';

export interface DoctorBasic {
  id: string;
  consultationPriceCents: number;
}

// Query síncrona según ADR-001-sync-vs-async.md: el paciente necesita el
// resultado en la misma respuesta HTTP de creación de la cita. "Disponible"
// aquí significa únicamente "dentro del horario configurado del doctor" —
// Doctors no sabe qué slots ya están reservados (cero estado compartido,
// RFC-001): esa verificación de conflicto vive en el propio repositorio de
// Appointments (ver appointments.repository.ts, transacción Serializable).
export interface DoctorsClient {
  getDoctor: (doctorId: string) => Promise<DoctorBasic | null>;
  getAvailableSlots: (doctorId: string, date: string) => Promise<string[]>;
}

const DOCTORS_UNAVAILABLE = (): never => {
  throw new AppError(502, 'DOCTORS_UNAVAILABLE', 'Servicio de doctores no disponible');
};

export const buildHttpDoctorsClient = (baseUrl: string): DoctorsClient => ({
  getDoctor: async (doctorId) => {
    const response = await fetch(`${baseUrl}/v1/doctors/${doctorId}`).catch(DOCTORS_UNAVAILABLE);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      return DOCTORS_UNAVAILABLE();
    }
    const body = (await response.json()) as DoctorBasic;
    return { id: body.id, consultationPriceCents: body.consultationPriceCents };
  },

  getAvailableSlots: async (doctorId, date) => {
    const url = `${baseUrl}/v1/doctors/${doctorId}/slots?date=${encodeURIComponent(date)}`;
    const response = await fetch(url).catch(DOCTORS_UNAVAILABLE);
    if (!response.ok) {
      return DOCTORS_UNAVAILABLE();
    }
    const body = (await response.json()) as { slots: string[] };
    return body.slots;
  },
});
