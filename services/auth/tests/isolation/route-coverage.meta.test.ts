import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

// Rutas de infraestructura (health/metrics/JWKS) -- no son datos de tenant,
// no hay nada que aislar. login/refresh también quedan exentos: por diseño
// son cross-tenant (resuelven el tenant DESDE las credenciales, no lo
// reciben) -- ver middleware/tenant-context.ts.
const EXEMPT = new Set([
  'GET /health',
  'GET /metrics',
  'GET /v1/auth/.well-known/jwks.json',
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
]);

// Todo endpoint de datos de tenant debe tener al menos un test de
// aislamiento asociado en tenant-isolation.test.ts, listado aquí. Si
// agregas una ruta nueva y no la agregas a esta lista (o a EXEMPT arriba),
// este test falla -- evita que un endpoint se quede sin pensar su
// aislamiento cross-tenant.
const COVERED = new Set(['POST /v1/users', 'GET /v1/users', 'PATCH /v1/users/:id/deactivate']);

const ROUTE_CALL = /app\.(get|post|patch|put|delete)\(\s*\n?\s*['"]([^'"]+)['"]/g;

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
