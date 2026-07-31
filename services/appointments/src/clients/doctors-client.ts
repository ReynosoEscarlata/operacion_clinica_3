import { XRAY_TRACE_HEADER } from '@clinica/observability';

import { AppError } from '../lib/app-error.js';
import { REQUEST_ID_HEADER } from '../lib/constants.js';
import { getRequestId, getTraceId } from '../lib/request-context.js';

export interface DoctorBasic {
  id: string;
  tenantId: string;
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

// Propaga requestId + trace de X-Ray al servicio downstream (Fase 6,
// ADR-017) -- sin esto, una llamada síncrona servicio-a-servicio pierde la
// correlación exacta con la request que la originó, tanto en logs
// (requestId) como en la consola de X-Ray (trace).
const correlationHeaders = (): Record<string, string> => {
  const requestId = getRequestId();
  const traceId = getTraceId();
  return {
    ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
    ...(traceId ? { [XRAY_TRACE_HEADER]: traceId } : {}),
  };
};

export const buildHttpDoctorsClient = (baseUrl: string): DoctorsClient => ({
  getDoctor: async (doctorId) => {
    const response = await fetch(`${baseUrl}/v1/doctors/${doctorId}`, { headers: correlationHeaders() }).catch(
      DOCTORS_UNAVAILABLE,
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      return DOCTORS_UNAVAILABLE();
    }
    const body = (await response.json()) as DoctorBasic;
    return { id: body.id, tenantId: body.tenantId, consultationPriceCents: body.consultationPriceCents };
  },

  getAvailableSlots: async (doctorId, date) => {
    const url = `${baseUrl}/v1/doctors/${doctorId}/slots?date=${encodeURIComponent(date)}`;
    const response = await fetch(url, { headers: correlationHeaders() }).catch(DOCTORS_UNAVAILABLE);
    if (!response.ok) {
      return DOCTORS_UNAVAILABLE();
    }
    const body = (await response.json()) as { slots: string[] };
    return body.slots;
  },
});
