import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { resolveCancelledBy } from '../../src/lib/internal-role.js';

const buildRequest = (headers: Record<string, string | string[] | undefined>): FastifyRequest =>
  ({ headers }) as unknown as FastifyRequest;

describe('resolveCancelledBy', () => {
  it('sin header interno, asume que cancela el paciente', () => {
    expect(resolveCancelledBy(buildRequest({}))).toBe('PATIENT');
  });

  it('con rol ADMIN reenviado por el gateway, asume que cancela un admin', () => {
    expect(resolveCancelledBy(buildRequest({ 'x-internal-user-role': 'ADMIN' }))).toBe('ADMIN');
  });

  it('con rol STAFF reenviado por el gateway, asume que cancela un admin', () => {
    expect(resolveCancelledBy(buildRequest({ 'x-internal-user-role': 'STAFF' }))).toBe('ADMIN');
  });

  it('con un rol desconocido, no confía y asume paciente', () => {
    expect(resolveCancelledBy(buildRequest({ 'x-internal-user-role': 'algo-raro' }))).toBe(
      'PATIENT',
    );
  });
});
