import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';

import { env } from '../config/env.js';
import { logger } from './logger.js';

// 6 procesos reales (Fase 6, ADR-017) -- duplicado a mano desde
// infra/config/environments.ts (CONTAINER_NAMES): este servicio no depende
// de infra/, que es un proyecto npm separado sin workspace en común.
const SERVICE_NAMES = ['auth', 'appointments', 'doctors', 'payments', 'notifications', 'gateway'] as const;

const CACHE_TTL_MS = 60_000;
const METRICS_WINDOW_MINUTES = 15;

export interface PerServiceMetrics {
  requestCount: number;
  errorCount: number;
  latencyP95Ms: number;
}

export interface PlatformMetricsData {
  aggregate: {
    requestCount: number;
    errorCount: number;
    errorRatePercent: number;
    // NO es un p95 matemáticamente agregado (un p95 no se puede derivar
    // sumando/promediando p95 individuales) -- es el máximo entre los p95
    // por servicio, una cota superior conservadora, no el p95 real del
    // tráfico combinado. Documentado explícitamente para no sugerir una
    // precisión que esta métrica no tiene.
    latencyP95MaxMs: number;
  };
  perService: Record<(typeof SERVICE_NAMES)[number], PerServiceMetrics>;
}

export type PlatformMetricsResult =
  | { available: true; data: PlatformMetricsData }
  | { available: false; reason: string };

let cache: { expiresAt: number; result: PlatformMetricsResult } | undefined;

const client = new CloudWatchClient({ region: env.AWS_REGION, ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}) });

// GetMetricData se cobra por métrica solicitada -- cachear 60s en proceso
// evita que cada refresh del panel ejecutivo dispare 18 queries nuevas
// (3 métricas × 6 servicios) contra CloudWatch.
export const getPlatformMetrics = async (): Promise<PlatformMetricsResult> => {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.result;
  }

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - METRICS_WINDOW_MINUTES * 60_000);

  const queries = SERVICE_NAMES.flatMap((serviceName) => [
    {
      Id: `req_${serviceName}`,
      MetricStat: {
        Metric: {
          Namespace: env.EMF_NAMESPACE,
          MetricName: 'RequestCount',
          Dimensions: [
            { Name: 'Service', Value: serviceName },
            { Name: 'Environment', Value: env.ENV_NAME },
          ],
        },
        Period: METRICS_WINDOW_MINUTES * 60,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    {
      Id: `err_${serviceName}`,
      MetricStat: {
        Metric: {
          Namespace: env.EMF_NAMESPACE,
          MetricName: 'ErrorCount',
          Dimensions: [
            { Name: 'Service', Value: serviceName },
            { Name: 'Environment', Value: env.ENV_NAME },
          ],
        },
        Period: METRICS_WINDOW_MINUTES * 60,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    {
      Id: `lat_${serviceName}`,
      MetricStat: {
        Metric: {
          Namespace: env.EMF_NAMESPACE,
          MetricName: 'RequestLatency',
          Dimensions: [
            { Name: 'Service', Value: serviceName },
            { Name: 'Environment', Value: env.ENV_NAME },
          ],
        },
        Period: METRICS_WINDOW_MINUTES * 60,
        Stat: 'p95',
      },
      ReturnData: true,
    },
  ]);

  try {
    const response = await client.send(
      new GetMetricDataCommand({ StartTime: startTime, EndTime: endTime, MetricDataQueries: queries }),
    );

    const valueById = new Map<string, number>();
    for (const result of response.MetricDataResults ?? []) {
      if (result.Id) valueById.set(result.Id, result.Values?.[0] ?? 0);
    }

    const perService = {} as PlatformMetricsData['perService'];
    let totalRequests = 0;
    let totalErrors = 0;
    let maxLatencyP95 = 0;

    for (const serviceName of SERVICE_NAMES) {
      const requestCount = valueById.get(`req_${serviceName}`) ?? 0;
      const errorCount = valueById.get(`err_${serviceName}`) ?? 0;
      const latencyP95Ms = valueById.get(`lat_${serviceName}`) ?? 0;
      perService[serviceName] = { requestCount, errorCount, latencyP95Ms };
      totalRequests += requestCount;
      totalErrors += errorCount;
      maxLatencyP95 = Math.max(maxLatencyP95, latencyP95Ms);
    }

    const result: PlatformMetricsResult = {
      available: true,
      data: {
        aggregate: {
          requestCount: totalRequests,
          errorCount: totalErrors,
          errorRatePercent: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
          latencyP95MaxMs: maxLatencyP95,
        },
        perService,
      },
    };
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, result };
    return result;
  } catch (error) {
    // Degradado explícito (mismo criterio que el modo degradado ya usado
    // en el Challenge 4): CloudWatch no disponible no debe tumbar el
    // dashboard ejecutivo entero, solo esta sección.
    logger.error({ err: error }, 'No se pudo consultar CloudWatch GetMetricData para el dashboard ejecutivo');
    const result: PlatformMetricsResult = {
      available: false,
      reason: 'No se pudo consultar CloudWatch en este momento',
    };
    // No se cachea el fallo -- el próximo request reintenta de inmediato.
    return result;
  }
};
