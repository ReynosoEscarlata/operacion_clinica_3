import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

// Payments no expone NINGÚN endpoint que lea/liste datos propios filtrados
// por tenant -- a diferencia de Auth/Doctors/Appointments, aquí no hay
// superficie HTTP de "cross-tenant enumeration" que probar. El tenant es
// contexto opcional (ver middleware/tenant-context.ts, nunca 401) que solo
// enriquece el metadata de Stripe; su propagación end-to-end ya está
// cubierta en tests/integration/webhooks.test.ts (el caso "appointmentId
// pero sin tenantId en metadata"). Lo que sí necesita verificarse aquí es
// el aislamiento a nivel de BASE DE DATOS de WebhookEvent/OutboxEvent, ver
// tenant-isolation.test.ts.
const EXEMPT = new Set([
  'GET /health',
  'GET /metrics',
  'POST /v1/customers',
  'POST /v1/payment-intents',
  'POST /v1/payment-intents/:id/cancel',
  'POST /v1/refunds',
]);

// Cubierto en tests/integration/webhooks.test.ts (resolución de tenant
// desde metadata) y tests/isolation/tenant-isolation.test.ts (aislamiento
// de las filas resultantes a nivel de BD).
const COVERED = new Set(['POST /v1/webhooks/stripe']);

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
