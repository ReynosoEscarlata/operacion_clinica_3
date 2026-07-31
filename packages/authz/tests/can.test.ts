import { describe, expect, it } from 'vitest';

import type { AuthActor } from '../src/actor.js';
import { can, isOwnScoped } from '../src/can.js';
import { PERMISSION_MATRIX } from '../src/matrix.js';
import { PERMISSIONS } from '../src/permissions.js';
import { ROLES } from '../src/roles.js';
import type { AuthenticatedRole } from '../src/roles.js';

const actorWith = (role: AuthenticatedRole): AuthActor => ({
  sub: 'user-1',
  role,
  tenantId: role === 'platform_admin' || role === 'platform_support' ? null : 'tenant-a',
  doctorId: role === 'doctor' ? 'doctor-a' : null,
});

describe('PERMISSION_MATRIX: cobertura estructural', () => {
  it('define una celda para cada combinación de permiso × rol (28 × 7)', () => {
    for (const permission of PERMISSIONS) {
      for (const role of ROLES) {
        expect(PERMISSION_MATRIX[permission][role]).toMatch(/^(all|own|none)$/);
      }
    }
  });
});

describe('can(): traduce el grant de la matriz a un booleano', () => {
  const cases = PERMISSIONS.flatMap((permission) =>
    ROLES.filter((role): role is AuthenticatedRole => role !== 'patient').map(
      (role) => [permission, role, PERMISSION_MATRIX[permission][role]] as const,
    ),
  );

  it.each(cases)('%s / %s -> grant "%s"', (permission, role, grant) => {
    const expected = grant === 'all' || grant === 'own';
    expect(can(actorWith(role), permission)).toBe(expected);
  });
});

describe('isOwnScoped(): distingue "own" de "all" para el filtro ABAC del repositorio', () => {
  it('doctor sobre appointment:read es own-scoped', () => {
    expect(isOwnScoped(actorWith('doctor'), 'appointment:read')).toBe(true);
  });

  it('clinic_owner sobre appointment:read NO es own-scoped (acceso irrestricto)', () => {
    expect(isOwnScoped(actorWith('clinic_owner'), 'appointment:read')).toBe(false);
  });
});

// Spot checks independientes de las decisiones explícitas de RFC-004
// (sección "Decisiones que resolvieron celdas específicas") -- transcritas
// a mano desde el RFC, no derivadas de matrix.ts, para que una regresión en
// la matriz se note aquí en vez de solo en el `satisfies` de TypeScript.
describe('RFC-004: decisiones explícitas sobre celdas específicas', () => {
  it('doctor puede cancelar sus propias citas (misma regla ABAC que complete/mark_no_show)', () => {
    expect(can(actorWith('doctor'), 'appointment:cancel')).toBe(true);
    expect(isOwnScoped(actorWith('doctor'), 'appointment:cancel')).toBe(true);
  });

  it('receptionist tiene alcance operativo completo sobre citas y pacientes', () => {
    for (const permission of [
      'appointment:create',
      'appointment:list',
      'appointment:cancel',
      'appointment:complete',
      'appointment:mark_no_show',
      'patient:create',
      'patient:list',
      'patient:update',
    ] as const) {
      expect(can(actorWith('receptionist'), permission)).toBe(true);
    }
  });

  it('receptionist NO tiene doctor:manage_availability ni las capacidades exclusivas de clinic_owner', () => {
    expect(can(actorWith('receptionist'), 'doctor:manage_availability')).toBe(false);
    expect(can(actorWith('receptionist'), 'user:create')).toBe(false);
    expect(can(actorWith('receptionist'), 'doctor:create')).toBe(false);
    expect(can(actorWith('receptionist'), 'payment:refund')).toBe(false);
  });

  it('clinic_owner tiene capacidades administrativas/financieras exclusivas que clinic_admin no tiene', () => {
    for (const permission of ['user:create', 'user:deactivate', 'doctor:create', 'payment:refund'] as const) {
      expect(can(actorWith('clinic_owner'), permission)).toBe(true);
      expect(can(actorWith('clinic_admin'), permission)).toBe(false);
    }
    // clinic_admin sí opera el día a día:
    expect(can(actorWith('clinic_admin'), 'appointment:complete')).toBe(true);
  });

  it('platform_support nunca tiene payment:refund ni capacidades de escritura sobre usuarios/doctores', () => {
    for (const permission of ['payment:refund', 'user:create', 'user:deactivate', 'doctor:create'] as const) {
      expect(can(actorWith('platform_support'), permission)).toBe(false);
    }
  });

  it('permisos de pago internos (create_customer/create_intent/cancel_intent) son exclusivos de platform_admin', () => {
    for (const permission of ['payment:create_customer', 'payment:create_intent', 'payment:cancel_intent'] as const) {
      expect(can(actorWith('platform_admin'), permission)).toBe(true);
      expect(can(actorWith('clinic_owner'), permission)).toBe(false);
    }
  });

  it('dead_letter:* es exclusivo del plano de plataforma', () => {
    for (const permission of ['dead_letter:read', 'dead_letter:retry', 'dead_letter:remove'] as const) {
      expect(can(actorWith('platform_admin'), permission)).toBe(true);
      expect(can(actorWith('platform_support'), permission)).toBe(true);
      expect(can(actorWith('clinic_owner'), permission)).toBe(false);
    }
  });

  it('doctor:list/read/read_slots son de acceso público (todo rol autenticado los tiene)', () => {
    for (const role of ROLES.filter((r): r is AuthenticatedRole => r !== 'patient')) {
      expect(can(actorWith(role), 'doctor:list')).toBe(true);
      expect(can(actorWith(role), 'doctor:read')).toBe(true);
      expect(can(actorWith(role), 'doctor:read_slots')).toBe(true);
    }
  });
});
