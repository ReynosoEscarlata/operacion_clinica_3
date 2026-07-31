import xRayFastifyPluginImport from 'aws-xray-sdk-fastify';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { configureSampling, formatTraceHeader, type XraySamplingConfig } from './xray.js';

interface XRayFastifyPluginOptions {
  segmentName: string;
  automaticMode: boolean;
  captureAWS: boolean;
  captureHTTP: boolean;
  capturePromises: boolean;
}

// El paquete `aws-xray-sdk-fastify` es CJS puro (module.exports = fn, sin
// marca __esModule) -- la resolución de tipos de su `index.d.ts` bajo
// NodeNext infiere el tipo del import default como el namespace del módulo
// en vez de la función del plugin. En runtime `require(...)` sí devuelve la
// función directamente (verificado leyendo el .js compilado); este cast
// corrige solo el tipo, no el valor.
const xRayFastifyPlugin = xRayFastifyPluginImport as unknown as FastifyPluginAsync<XRayFastifyPluginOptions>;

export interface XrayContext {
  // `| undefined` explícito -- mismo motivo que en emf.ts: exactOptionalPropertyTypes
  // exige que el tipo declarado incluya `undefined` cuando el caller pasa el
  // resultado directo de getTenantId()/getRequestId() (que devuelven
  // `T | undefined` cuando no hay contexto ambiental) en vez de omitir la clave.
  tenantId?: string | null | undefined;
  requestId?: string | undefined;
}

export interface RegisterXrayOptions {
  enabled: boolean;
  serviceName: string;
  sampling: XraySamplingConfig;
  // Cada servicio tiene su PROPIO tenant-context.ts/request-context.ts
  // (AsyncLocalStorage, un archivo por servicio, no compartido) -- este
  // paquete no puede importarlos directo, así que el caller (app.ts de cada
  // servicio) pasa una función que lee su propio contexto ambiental.
  getContext: () => XrayContext;
  // Simétrico a `getContext`: el segmento nace acá (onRequest, modo manual),
  // pero solo el caller sabe dónde guardar el trace header para que los
  // clientes HTTP síncronos (doctors-client.ts, payments-client.ts) lo lean
  // ambientalmente más tarde en el mismo request.
  onTraceHeader?: (traceHeader: string) => void;
}

// Anotaciones (indexables/filtrables en la consola de X-Ray): tenantId,
// requestId, route -- SIEMPRE el patrón (`routeOptions.url`), NUNCA la URL
// cruda (existe GET /v1/patients/by-email?email=... en este repo -- no es
// un riesgo teórico). Metadata (no indexable, informativa): method,
// statusCode. Prohibido: query strings, body -- ver README de este paquete
// y ADR-017.
export const registerXray = async (app: FastifyInstance, options: RegisterXrayOptions): Promise<void> => {
  if (!options.enabled) return;

  configureSampling(options.sampling);

  // automaticMode: false -- el plugin oficial solo popula `request.segment`
  // en modo manual (en modo automático solo queda accesible vía
  // AWSXRay.getSegment(), atado a cls-hooked). No necesitamos propagar el
  // segmento a través de captures asíncronos anidados, así que el modo
  // manual es más simple y suficiente para anotar el segmento por request.
  await app.register(xRayFastifyPlugin, {
    segmentName: options.serviceName,
    automaticMode: false,
    captureAWS: false,
    captureHTTP: false,
    capturePromises: false,
  });

  app.addHook('onRequest', async (request) => {
    const segment = request.segment;
    if (!segment) return;

    const context = options.getContext();
    segment.addAnnotation('service', options.serviceName);
    if (context.requestId) segment.addAnnotation('requestId', context.requestId);
    if (context.tenantId) segment.addAnnotation('tenantId', context.tenantId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Segment no está tipado en aws-xray-sdk-core
    options.onTraceHeader?.(formatTraceHeader(segment as any));
  });

  app.addHook('onResponse', async (request, reply) => {
    const segment = request.segment;
    if (!segment) return;

    const route = request.routeOptions?.url ?? 'unmatched';
    segment.addAnnotation('route', route);
    segment.addMetadata('http', { method: request.method, statusCode: reply.statusCode });
  });
};
