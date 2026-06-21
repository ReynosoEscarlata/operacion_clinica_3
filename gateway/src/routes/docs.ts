import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';

// Docs públicas (PLAN.md Fase 4, punto 4): Redoc renderiza el YAML
// directamente en el browser (carga vía <script> desde su CDN, sin
// dependencias nuevas en el gateway) — el servidor solo sirve el YAML
// crudo de cada contrato. Los specs viven en gateway/openapi-specs/,
// copiados de packages/contracts/ (el build de Docker del gateway no
// tiene acceso a esa carpeta, queda fuera de su contexto — mismo patrón ya
// usado para event-consumer.ts entre Appointments/Notifications: hay que
// re-copiar a mano si el contrato cambia).
const SERVICES = ['auth', 'appointments', 'doctors', 'payments', 'notifications'] as const;
type ServiceName = (typeof SERVICES)[number];

const isServiceName = (value: string): value is ServiceName =>
  (SERVICES as readonly string[]).includes(value);

const specsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'openapi-specs');

const redocHtml = (service: ServiceName): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Clínica — ${service} API</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin: 0">
    <redoc spec-url="/docs/${service}/openapi.yaml"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;

const indexHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Clínica — Documentación de APIs</title>
  </head>
  <body style="font-family: sans-serif; max-width: 640px; margin: 4rem auto">
    <h1>Documentación de APIs — Clínica Scheduler</h1>
    <ul>
      ${SERVICES.map((service) => `<li><a href="/docs/${service}">${service}</a></li>`).join('\n      ')}
    </ul>
  </body>
</html>`;

export const registerDocsRoutes = (app: FastifyInstance): void => {
  app.get('/docs', async (_request, reply) => {
    reply.type('text/html').send(indexHtml);
  });

  app.get<{ Params: { service: string } }>('/docs/:service', async (request, reply) => {
    if (!isServiceName(request.params.service)) {
      return reply.status(404).send({ error: { code: 'UNKNOWN_SERVICE', message: 'Servicio no encontrado' } });
    }
    reply.type('text/html').send(redocHtml(request.params.service));
  });

  app.get<{ Params: { service: string } }>('/docs/:service/openapi.yaml', async (request, reply) => {
    if (!isServiceName(request.params.service)) {
      return reply.status(404).send({ error: { code: 'UNKNOWN_SERVICE', message: 'Servicio no encontrado' } });
    }
    const content = await readFile(path.join(specsDir, `${request.params.service}.yaml`), 'utf-8');
    reply.type('text/yaml').send(content);
  });
};
