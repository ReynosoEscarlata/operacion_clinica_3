import type { Logger } from './logger.js';

// Namespace y dimensiones fijas -- ADR-017: SOLO [Service, Environment],
// nunca tenantId ni route como dimensión (rompería el presupuesto de
// métricas custom ya comprometido en docs/cost/cost-model.md §3.5 -- ver
// la aritmética 57/60 documentada ahí). El desglose por tenant/ruta se hace
// vía CloudWatch Logs Insights sobre las propiedades no-dimensionales de
// este mismo documento, no vía una métrica nueva.
export interface EmitRequestMetricsInput {
  namespace: string;
  service: string;
  environment: string;
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  tenantId?: string | null;
  requestId?: string;
  traceId?: string;
}

export interface EmfDocument {
  _aws: {
    Timestamp: number;
    CloudWatchMetrics: Array<{
      Namespace: string;
      Dimensions: string[][];
      Metrics: Array<{ Name: string; Unit: string }>;
    }>;
  };
  Service: string;
  Environment: string;
  RequestCount: number;
  RequestLatency: number;
  ErrorCount: number;
  route: string;
  method: string;
  statusCode: number;
  tenantId?: string;
  requestId?: string;
  traceId?: string;
}

const ERROR_STATUS_THRESHOLD = 500;

// Serializador EMF a mano (no la lib oficial `aws-embedded-metrics`, que
// trae un modo de flush asíncrono y un agente que no hacen falta en
// Fargate detrás del log driver `awslogs` -- CloudWatch extrae la métrica
// directo de la línea de log, sin llamar a PutMetricData). El shape exacto
// (bloque `_aws` en la raíz + los nombres de métrica también en la raíz)
// es el contrato que documenta AWS para Embedded Metric Format.
export const buildRequestMetricsEmf = (input: EmitRequestMetricsInput): EmfDocument => {
  const isError = input.statusCode >= ERROR_STATUS_THRESHOLD;

  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: input.namespace,
          Dimensions: [['Service', 'Environment']],
          Metrics: [
            { Name: 'RequestCount', Unit: 'Count' },
            { Name: 'RequestLatency', Unit: 'Milliseconds' },
            { Name: 'ErrorCount', Unit: 'Count' },
          ],
        },
      ],
    },
    Service: input.service,
    Environment: input.environment,
    RequestCount: 1,
    RequestLatency: input.durationMs,
    ErrorCount: isError ? 1 : 0,
    route: input.route,
    method: input.method,
    statusCode: input.statusCode,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
};

// Transporte vía el logger Pino ya existente en cada servicio (no
// `process.stdout.write` directo): Pino mergea las claves del objeto en la
// raíz de la línea, que es exactamente el shape que EMF exige, y la línea
// hereda gratis el mixin de contexto (requestId/tenantId) que cada logger
// ya tiene configurado -- el drill-down por tenant en Logs Insights sale
// del mismo documento que produce la métrica, sin instrumentación extra.
export const emitRequestMetrics = (logger: Logger, input: EmitRequestMetricsInput): void => {
  logger.info(buildRequestMetricsEmf(input), 'emf_request_metrics');
};
