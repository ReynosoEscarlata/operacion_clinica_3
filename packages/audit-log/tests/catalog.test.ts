import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, AUDIT_RESULTS } from '../src/actions.js';
import { COMMON_REDACT_PATHS, REDACT_CENSOR } from '../src/redact.js';

describe('catálogo de auditoría', () => {
  it('no tiene acciones duplicadas', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('no tiene tipos de recurso duplicados', () => {
    expect(new Set(AUDIT_RESOURCE_TYPES).size).toBe(AUDIT_RESOURCE_TYPES.length);
  });

  it('solo permite success/failure como resultado', () => {
    expect(AUDIT_RESULTS).toEqual(['success', 'failure']);
  });
});

describe('rutas de redacción', () => {
  it('no tiene rutas duplicadas', () => {
    expect(new Set(COMMON_REDACT_PATHS).size).toBe(COMMON_REDACT_PATHS.length);
  });

  it('incluye los campos de PII y credenciales conocidos', () => {
    for (const field of ['email', 'phone', 'name', 'to', 'passwordHash', 'tokenHash']) {
      expect(COMMON_REDACT_PATHS).toContain(field);
    }
  });

  it('define un censor no vacío', () => {
    expect(REDACT_CENSOR.length).toBeGreaterThan(0);
  });
});
