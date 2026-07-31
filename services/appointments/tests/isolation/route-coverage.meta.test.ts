import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

const EXEMPT = new Set(['GET /health', 'GET /metrics']);

// Todo endpoint de datos de tenant debe tener al menos un test de
// aislamiento asociado en tenant-isolation.test.ts, listado aquí. Incluye
// las rutas exentas del header (POST /v1/patients, GET /v1/appointments/:id,
// etc.) -- "exenta de header" no es lo mismo que "sin aislamiento": esas
// resuelven el tenant por su cuenta (doctorId o SECURITY DEFINER) y
// necesitan su propio test de que no cruzan tenants.
const COVERED = new Set([
  'POST /v1/patients',
  'GET /v1/patients/by-email',
  'GET /v1/patients/:id',
  'PATCH /v1/patients/:id',
  'GET /v1/patients',
  'POST /v1/appointments',
  'GET /v1/appointments/:id',
  'PATCH /v1/appointments/:id/cancel',
  'GET /v1/appointments',
  'PATCH /v1/appointments/:id/complete',
  'PATCH /v1/appointments/:id/no-show',
  'GET /v1/admin/dashboard',
  'GET /v1/admin/events',
  'GET /v1/admin/dead-letter',
  'POST /v1/admin/dead-letter/:id/retry',
  'DELETE /v1/admin/dead-letter/:id',
]);

// (?:<[^>]*>)? -- ver el mismo comentario en
// services/auth/tests/isolation/route-coverage.meta.test.ts.
const ROUTE_CALL = /app\.(get|post|patch|put|delete)(?:<[^>]*>)?\(\s*\n?\s*['"]([^'"]+)['"]/g;

const extractRoutes = (dir: string): string[] => {
  const routes: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...extractRoutes(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    const content = fs.readFileSync(full, 'utf-8');
    for (const match of content.matchAll(ROUTE_CALL)) {
      const [, method, routePath] = match;
      if (method && routePath) {
        routes.push(`${method.toUpperCase()} ${routePath}`);
      }
    }
  }
  return routes;
};

describe('META: cobertura de tests de aislamiento por ruta', () => {
  it('toda ruta registrada tiene un test de aislamiento asociado o está explícitamente exenta', () => {
    const routes = extractRoutes(SRC_DIR);
    expect(routes.length).toBeGreaterThan(0);

    const uncovered = routes.filter((route) => !COVERED.has(route) && !EXEMPT.has(route));
    expect(uncovered).toEqual([]);
  });
});
