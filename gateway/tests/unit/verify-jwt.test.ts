import { describe, expect, it } from 'vitest';

import { isPublicRoute } from '../../src/middleware/verify-jwt.js';

describe('isPublicRoute', () => {
  it('permite reservar una cita sin token (paciente sin login)', () => {
    expect(isPublicRoute('POST', '/v1/appointments')).toBe(true);
  });

  it('permite login sin token', () => {
    expect(isPublicRoute('POST', '/v1/auth/login')).toBe(true);
  });

  it('exige token para listar pacientes (operación de admin)', () => {
    expect(isPublicRoute('GET', '/v1/patients')).toBe(false);
  });

  it('permite buscar un paciente por email sin token (evita duplicados al reservar)', () => {
    expect(isPublicRoute('GET', '/v1/patients/by-email')).toBe(true);
  });

  it('permite que el paciente cancele su propia cita sin token (identificado por el UUID)', () => {
    expect(isPublicRoute('PATCH', '/v1/appointments/123/cancel')).toBe(true);
  });

  it('permite ver el detalle de una cita por su UUID sin token', () => {
    expect(isPublicRoute('GET', '/v1/appointments/123')).toBe(true);
  });

  it('exige token para listar todas las citas (operación de admin)', () => {
    expect(isPublicRoute('GET', '/v1/appointments')).toBe(false);
  });

  it('exige token para marcar una cita como completada o no-show', () => {
    expect(isPublicRoute('PATCH', '/v1/appointments/123/complete')).toBe(false);
    expect(isPublicRoute('PATCH', '/v1/appointments/123/no-show')).toBe(false);
  });

  it('permite rutas propias del gateway sin token', () => {
    expect(isPublicRoute('GET', '/healthz')).toBe(true);
    expect(isPublicRoute('GET', '/metrics')).toBe(true);
  });

  it('permite ver los horarios disponibles de un doctor sin token, con query string', () => {
    expect(isPublicRoute('GET', '/v1/doctors/123/slots?date=2026-06-22')).toBe(true);
  });

  it('permite buscar un paciente por email sin token, con query string', () => {
    expect(isPublicRoute('GET', '/v1/patients/by-email?email=a@a.com')).toBe(true);
  });

  it('permite ver un paciente por su id sin token (flujo público de reserva)', () => {
    expect(isPublicRoute('GET', '/v1/patients/123')).toBe(true);
  });

  it('exige token para listar pacientes incluso con query string', () => {
    expect(isPublicRoute('GET', '/v1/patients?cursor=abc')).toBe(false);
  });
});
