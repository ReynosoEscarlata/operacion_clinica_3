import { describe, expect, it, vi } from 'vitest';

import { logAuthzDenied, logCrossTenantAccessDenied } from '../src/security-events.js';

describe('logCrossTenantAccessDenied', () => {
  it('loguea con severity critical y event=cross_tenant_access_denied (shape que matchea el metric filter)', () => {
    const logger = { error: vi.fn() };

    logCrossTenantAccessDenied(logger as never, {
      service: 'appointments',
      resource: 'appointment',
      resourceId: 'apt-1',
      actorTenantId: 'tenant-a',
      resourceTenantId: 'tenant-b',
      actorRole: 'clinic_owner',
      actorSub: 'user-1',
      requestId: 'req-1',
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'cross_tenant_access_denied',
        securityEvent: true,
        severity: 'critical',
        resource: 'appointment',
        resourceId: 'apt-1',
        actorTenantId: 'tenant-a',
        resourceTenantId: 'tenant-b',
      }),
      expect.any(String),
    );
  });

  it('nunca incluye una fila completa del recurso -- solo IDs y metadatos de actor', () => {
    const logger = { error: vi.fn() };

    logCrossTenantAccessDenied(logger as never, {
      service: 'appointments',
      resource: 'patient',
      resourceId: 'patient-1',
      actorTenantId: null,
      resourceTenantId: 'tenant-b',
      actorRole: 'platform_support',
      actorSub: null,
    });

    const [loggedEvent] = logger.error.mock.calls[0] as [Record<string, unknown>, string];
    const keys = Object.keys(loggedEvent);
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('payload');
  });
});

describe('logAuthzDenied', () => {
  it('loguea con severity warn y event=authz_denied', () => {
    const logger = { warn: vi.fn() };

    logAuthzDenied(logger as never, {
      service: 'appointments',
      permission: 'appointment:cancel',
      actorRole: 'doctor',
      actorSub: 'user-2',
      actorTenantId: 'tenant-a',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'authz_denied', securityEvent: true, severity: 'warn' }),
      expect.any(String),
    );
  });
});
