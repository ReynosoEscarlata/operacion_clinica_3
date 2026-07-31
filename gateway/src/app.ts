import { registerXray } from '@clinica/observability';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { env } from './config/env.js';
import { getRequestId, getTenantId, setTraceId } from './lib/request-context.js';
import { verifyJwt } from './middleware/verify-jwt.js';
import { registerMetricsMiddleware } from './middleware/metrics.js';
import { registerRawBodyPassthrough } from './middleware/raw-body.js';
import { registerRequestId } from './middleware/request-id.js';
import { registerDocsRoutes } from './routes/docs.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMetricsRoute } from './routes/metrics.js';
import { registerProxyRoutes } from './routes/proxy.js';

export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });

  // Primer hook: todo lo demás (logs, X-Ray, el reenvío al servicio
  // upstream) depende de que requestId ya esté en el header/contexto antes
  // de que corra cualquier otra cosa (Fase 6, ADR-017).
  registerRequestId(app);

  // A diferencia de los 5 servicios, tenantId todavía no existe acá (recién
  // se puebla en el preHandler de verify-jwt, más abajo) -- el segmento
  // anota tenantId=undefined en este proceso; el desglose real por tenant
  // sigue viviendo en el segmento del servicio downstream, que sí lo tiene
  // en el momento correcto.
  await registerXray(app, {
    enabled: env.XRAY_ENABLED,
    serviceName: 'gateway',
    sampling: { fixedTarget: 1, rate: env.XRAY_SAMPLING_RATE },
    getContext: () => ({ tenantId: getTenantId(), requestId: getRequestId() }),
    onTraceHeader: setTraceId,
  });

  // El panel admin (Vite, otro origen) y el flujo público de reserva llaman
  // al gateway directo desde el browser — sin esto, el navegador bloquea las
  // respuestas por CORS aunque la request llegue bien (curl no lo sufre,
  // por eso no apareció antes). Mismo plugin que ya usa el monolito.
  await app.register(cors);
  registerMetricsMiddleware(app);

  registerRawBodyPassthrough(app);

  await registerHealthRoute(app);
  await registerMetricsRoute(app);
  registerDocsRoutes(app);

  app.addHook('preHandler', verifyJwt);

  await registerProxyRoutes(app);

  return app;
};
