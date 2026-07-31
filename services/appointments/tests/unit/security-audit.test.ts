import { afterEach, describe, expect, it, vi } from 'vitest';

// Amenaza #3 del threat model (IDOR por posesión de UUID): este test cubre
// exactamente el caso que la alarma de acceso cross-tenant (Fase 6,
// ADR-017) necesita detectar -- sin él, un refactor futuro de
// auditCrossTenantMismatch podría dejar de loguear el evento sin que
// ninguna suite lo note (el 404 seguiría siendo correcto igual).
const { logCrossTenantAccessDeniedMock } = vi.hoisted(() => ({
  logCrossTenantAccessDeniedMock: vi.fn(),
}));

vi.mock('@clinica/observability', () => ({
  logCrossTenantAccessDenied: logCrossTenantAccessDeniedMock,
}));

vi.mock('../../src/lib/authz-context.js', () => ({
  getAuthActor: vi.fn(),
}));

vi.mock('../../src/lib/request-context.js', () => ({
  getRequestId: vi.fn(() => 'req-1'),
  getTraceId: vi.fn(() => 'Root=1-a;Parent=b;Sampled=1'),
}));

import { auditCrossTenantMismatch } from '../../src/lib/security-audit.js';
import { getAuthActor } from '../../src/lib/authz-context.js';

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

describe('auditCrossTenantMismatch', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loguea cross_tenant_access_denied cuando el tenant real del recurso difiere del ambiental', async () => {
    vi.mocked(getAuthActor).mockReturnValue({
      sub: 'user-1',
      role: 'receptionist',
      tenantId: 'tenant-a',
      doctorId: null,
    });

    await auditCrossTenantMismatch(fakeLogger, 'appointment', 'appt-1', 'tenant-a', async () => 'tenant-b');

    expect(logCrossTenantAccessDeniedMock).toHaveBeenCalledWith(fakeLogger, {
      service: 'appointments',
      resource: 'appointment',
      resourceId: 'appt-1',
      actorTenantId: 'tenant-a',
      resourceTenantId: 'tenant-b',
      actorRole: 'receptionist',
      actorSub: 'user-1',
      requestId: 'req-1',
      traceId: 'Root=1-a;Parent=b;Sampled=1',
    });
  });

  it('no loguea nada cuando el recurso realmente no existe (resolve devuelve null)', async () => {
    await auditCrossTenantMismatch(fakeLogger, 'patient', 'patient-1', 'tenant-a', async () => null);

    expect(logCrossTenantAccessDeniedMock).not.toHaveBeenCalled();
  });

  it('no loguea nada cuando el tenant real coincide con el ambiental (no es cross-tenant)', async () => {
    await auditCrossTenantMismatch(fakeLogger, 'patient', 'patient-1', 'tenant-a', async () => 'tenant-a');

    expect(logCrossTenantAccessDeniedMock).not.toHaveBeenCalled();
  });

  it('usa actorRole "desconocido" cuando no hay AuthActor en contexto', async () => {
    vi.mocked(getAuthActor).mockReturnValue(null);

    await auditCrossTenantMismatch(fakeLogger, 'appointment', 'appt-2', 'tenant-a', async () => 'tenant-c');

    expect(logCrossTenantAccessDeniedMock).toHaveBeenCalledWith(
      fakeLogger,
      expect.objectContaining({ actorRole: 'desconocido', actorSub: null }),
    );
  });
});
