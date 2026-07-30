import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

// El directorio de doctores es público a propósito (RLS asimétrico) --
// listar/ver un doctor y sus horarios nunca depende del tenant del actor,
// así que no aplica un test de "aislamiento cross-tenant" en el sentido de
// evitar una fuga: la cobertura para esas rutas es "sigue siendo pública
// tras la migración", no "está aislada".
const EXEMPT = new Set([
  'GET /health',
  'GET /metrics',
  'GET /v1/doctors',
  'GET /v1/doctors/:id',
  'GET /v1/doctors/:id/slots',
]);

// Todo endpoint de escritura debe tener al menos un test de aislamiento
// asociado en tenant-isolation.test.ts, listado aquí. Si agregas una ruta
// nueva y no la agregas a esta lista (o a EXEMPT arriba), este test falla.
const COVERED = new Set(['POST /v1/doctors', 'POST /v1/doctors/:id/availability']);

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
