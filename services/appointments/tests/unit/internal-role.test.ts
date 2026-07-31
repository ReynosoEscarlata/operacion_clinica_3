import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { resolveCancelledBy } from '../../src/lib/internal-role.js';

const buildRequest = (headers: Record<string, string | string[] | undefined>): FastifyRequest =>
  ({ headers }) as unknown as FastifyRequest;

describe('resolveCancelledBy', () => {
  it('sin header interno, asume que cancela el paciente', () => {
    expect(resolveCancelledBy(buildRequest({}))).toBe('PATIENT');
  });

  it('con rol clinic_owner reenviado por el gateway, asume que cancela un admin', () => {
    expect(resolveCancelledBy(buildRequest({ 'x-internal-user-role': 'clinic_owner' }))).toBe('ADMIN');
  });

  it('con rol receptionist reenviado por el gateway, asume que cancela un admin', () => {
    expect(resolveCancelledBy(buildRequest({ 'x-internal-user-role': 'receptionist' }))).toBe('ADMIN');
  });

  it('con rol doctor reenviado por el gateway, asume que cancela un admin', () => {
    expect(resolveCancelledBy(buildRequest({ 'x-internal-user-role': 'doctor' }))).toBe('ADMIN');
  });

  it('con un rol desconocido (ej. el formato viejo ADMIN/STAFF, pre-Fase 4), no confía y asume paciente', () => {
    expect(resolveCancelledBy(buildRequest({ 'x-internal-user-role': 'ADMIN' }))).toBe('PATIENT');
  });

  it('con un rol desconocido, no confía y asume paciente', () => {
    expect(resolveCancelledBy(buildRequest({ 'x-internal-user-role': 'algo-raro' }))).toBe('PATIENT');
  });
});
