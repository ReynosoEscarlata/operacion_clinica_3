// Dos tenants fijos, compartidos por toda la suite de aislamiento (Fase 3a).
// Nunca se usan fuera de tests/isolation/ -- cada archivo de test "normal"
// define su propio tenant fijo para no interferir con estos.
export const TENANT_A = 'a0000000-a000-a000-a000-a00000000001';
export const TENANT_B = 'b0000000-b000-b000-b000-b00000000002';

export const headersFor = (tenantId: string): Record<string, string> => ({
  'x-internal-tenant-id': tenantId,
});
