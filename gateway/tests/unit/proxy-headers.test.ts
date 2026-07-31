import { describe, expect, it } from 'vitest';

import { buildInternalHeaders } from '../../src/routes/proxy.js';

describe('buildInternalHeaders', () => {
  it('sin request.user no agrega ningún header interno', () => {
    const headers = buildInternalHeaders({}, { 'content-type': 'application/json' });
    expect(headers).toEqual({ 'content-type': 'application/json' });
  });

  it('con un actor de tenant reenvía sub, rol y tenant_id, sin doctor_id', () => {
    const headers = buildInternalHeaders(
      {
        user: {
          sub: 'user-1',
          role: 'clinic_owner',
          tenantId: '11111111-1111-1111-1111-111111111111',
          doctorId: null,
          supportGrantId: null,
        },
      },
      {},
    );
    expect(headers).toEqual({
      'x-internal-user-id': 'user-1',
      'x-internal-user-role': 'clinic_owner',
      'x-internal-tenant-id': '11111111-1111-1111-1111-111111111111',
    });
  });

  it('con un actor de plataforma (tenantId null) no reenvía tenant_id', () => {
    const headers = buildInternalHeaders(
      { user: { sub: 'user-1', role: 'platform_admin', tenantId: null, doctorId: null, supportGrantId: null } },
      {},
    );
    expect(headers).toEqual({ 'x-internal-user-id': 'user-1', 'x-internal-user-role': 'platform_admin' });
  });

  it('con un doctor reenvía doctor_id además de sub, rol y tenant_id (RFC-004, filtro ABAC)', () => {
    const headers = buildInternalHeaders(
      {
        user: {
          sub: 'user-1',
          role: 'doctor',
          tenantId: '11111111-1111-1111-1111-111111111111',
          doctorId: '22222222-2222-2222-2222-222222222222',
          supportGrantId: null,
        },
      },
      {},
    );
    expect(headers).toEqual({
      'x-internal-user-id': 'user-1',
      'x-internal-user-role': 'doctor',
      'x-internal-tenant-id': '11111111-1111-1111-1111-111111111111',
      'x-internal-doctor-id': '22222222-2222-2222-2222-222222222222',
    });
  });

  it('con un token de elevación reenvía support_grant_id (RFC-004, escalada de platform_support)', () => {
    const headers = buildInternalHeaders(
      {
        user: {
          sub: 'user-1',
          role: 'platform_support',
          tenantId: '11111111-1111-1111-1111-111111111111',
          doctorId: null,
          supportGrantId: '33333333-3333-3333-3333-333333333333',
        },
      },
      {},
    );
    expect(headers).toEqual({
      'x-internal-user-id': 'user-1',
      'x-internal-user-role': 'platform_support',
      'x-internal-tenant-id': '11111111-1111-1111-1111-111111111111',
      'x-internal-support-grant-id': '33333333-3333-3333-3333-333333333333',
    });
  });
});
