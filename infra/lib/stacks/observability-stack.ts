import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as snsActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import { CONTAINER_NAMES, type EnvironmentConfig } from '../../config/environments.js';
import { AlarmWithRunbook } from '../constructs/alarm-with-runbook.js';
import type { ComputeStack } from './compute-stack.js';
import type { MessagingStack } from './messaging-stack.js';
import type { EdgeStack } from './edge-stack.js';

export interface ObservabilityStackProps extends StackProps {
  config: EnvironmentConfig;
  compute: ComputeStack;
  messaging: MessagingStack;
  edge: EdgeStack;
  operationalAlarmTopic: sns.ITopic;
  securityAlarmTopic: sns.ITopic;
}

// Namespace/nombres de métrica EMF -- deben calzar byte a byte con
// packages/observability/src/emf.ts (el mismo documento que produce la
// métrica). Namespace de seguridad separado (Clinica/Security) para la
// métrica de acceso cross-tenant, sin dimensión de servicio (ver la
// aritmética 57/60 de docs/cost/cost-model.md §3.5 -- una dimensión más
// por servicio rompería el presupuesto).
const EMF_NAMESPACE = 'Clinica';
const SECURITY_NAMESPACE = 'Clinica/Security';
const ERROR_RATE_THRESHOLD_PERCENT = 1;
// NO VERIFICADO contra tráfico real (no existe todavía) -- valor de
// arranque, a recalibrar (ADR-017, "cosas a monitorear").
const LATENCY_P95_THRESHOLD_MS = 1000;

// Fundacion de la Fase 6 (observabilidad y costos) — dashboards y alarmas
// base, NO las metricas RED completas por tenant que exige esa fase (eso
// requiere que exista tenant_id, Fase 3). Aqui: por-servicio (CPU, targets
// saludables) y por-cola (profundidad de dead-letter, la senal mas directa
// de "algo se esta reintentando sin exito").
export class ObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { config, compute, messaging, edge, operationalAlarmTopic, securityAlarmTopic } = props;
    const prefix = `clinica-${config.envName}`;
    const alarmAction = new snsActions.SnsAction(operationalAlarmTopic);
    const securityAlarmAction = new snsActions.SnsAction(securityAlarmTopic);

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${prefix}-plataforma`,
    });

    // Métrica sin dimensión de servicio (Fase 6, ADR-017): todos los metric
    // filters de los 6 log groups escriben al mismo par namespace/nombre --
    // el servicio concreto se recupera en Logs Insights (ver
    // docs/runbooks/consultas-logs-insights.md), no como dimensión (18
    // combinaciones de más rompería el presupuesto de §4 de cost-model.md).
    const crossTenantMetric = new cloudwatch.Metric({
      namespace: SECURITY_NAMESPACE,
      metricName: 'CrossTenantAccessDenied',
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    for (const name of CONTAINER_NAMES) {
      const service = compute.services[name];
      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: `${name} — CPU %`,
          left: [service.service.metricCpuUtilization()],
          width: 8,
        }),
      );

      // Metricas de target group (targets no saludables, requests) solo
      // existen para el gateway: es el unico target group atado a un load
      // balancer real (edge-stack) — los otros 5 servicios no se exponen
      // detras del ALB publico (RFC-001 del Challenge 4: el gateway es el
      // unico punto de entrada). Intentar leer estas metricas sobre un
      // target group sin load balancer asociado falla en `cdk synth`.
      if (name === 'gateway') {
        dashboard.addWidgets(
          new cloudwatch.GraphWidget({
            title: `${name} — targets no saludables`,
            left: [edge.gatewayTargetGroup.metricUnhealthyHostCount()],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: `${name} — requests`,
            left: [edge.gatewayTargetGroup.metricRequestCount()],
            width: 8,
          }),
        );
      }

      // Métricas RED vía EMF (packages/observability/src/emf.ts) --
      // dimensiones [Service, Environment] únicamente, nunca tenantId ni
      // route (ver la aritmética 57/60 de cost-model.md §3.5). El desglose
      // por tenant/ruta es una query de Logs Insights sobre el mismo
      // documento, no una dimensión de métrica nueva.
      const dimensionsMap = { Service: name, Environment: config.envName };
      const requestCountMetric = new cloudwatch.Metric({
        namespace: EMF_NAMESPACE,
        metricName: 'RequestCount',
        dimensionsMap,
        statistic: 'Sum',
        period: Duration.minutes(5),
      });
      const errorCountMetric = new cloudwatch.Metric({
        namespace: EMF_NAMESPACE,
        metricName: 'ErrorCount',
        dimensionsMap,
        statistic: 'Sum',
        period: Duration.minutes(5),
      });
      const latencyP95Metric = new cloudwatch.Metric({
        namespace: EMF_NAMESPACE,
        metricName: 'RequestLatency',
        dimensionsMap,
        statistic: 'p95',
        period: Duration.minutes(5),
      });
      // fill(..., 0): sin requests en el periodo, ErrorCount tampoco tiene
      // datapoint -- sin esto la expresión completa queda sin datos y la
      // math expression no se evalúa (no es lo mismo que error rate = 0%).
      const errorRateMetric = new cloudwatch.MathExpression({
        expression: '(errors / FILL(requests, 0)) * 100',
        usingMetrics: { errors: errorCountMetric, requests: requestCountMetric },
        period: Duration.minutes(5),
      });

      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: `${name} — requests (EMF)`,
          left: [requestCountMetric],
          width: 8,
        }),
        new cloudwatch.GraphWidget({
          title: `${name} — latencia p95 (EMF, ms)`,
          left: [latencyP95Metric],
          width: 8,
        }),
        new cloudwatch.GraphWidget({
          title: `${name} — error rate % (EMF)`,
          left: [errorRateMetric],
          width: 8,
        }),
      );

      // treatMissingData NOT_BREACHING en toda alarma basada en EMF: sin
      // esto, cada deploy nace en ALARM/INSUFFICIENT_DATA antes del primer
      // request real (EMF_ENABLED recién se activa en AWS real, ver
      // compute-stack.ts).
      new AlarmWithRunbook(this, `${name}ErrorRateAlarm`, {
        runbook: 'alarma-error-rate-5xx.md',
        alarmName: `${prefix}-${name}-error-rate-5xx`,
        alarmDescription: `Error rate de ${name} sobre ${ERROR_RATE_THRESHOLD_PERCENT}% (EMF)`,
        metric: errorRateMetric,
        threshold: ERROR_RATE_THRESHOLD_PERCENT,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).alarm.addAlarmAction(alarmAction);

      new AlarmWithRunbook(this, `${name}LatencyP95Alarm`, {
        runbook: 'alarma-latencia-p95.md',
        alarmName: `${prefix}-${name}-latencia-p95`,
        alarmDescription: `p95 de latencia de ${name} sobre ${LATENCY_P95_THRESHOLD_MS}ms (EMF)`,
        metric: latencyP95Metric,
        threshold: LATENCY_P95_THRESHOLD_MS,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).alarm.addAlarmAction(alarmAction);

      // Metric filter de acceso cross-tenant (amenaza #3 del threat model,
      // el caso que esta alarma existe para probar que se entendió): uno
      // por cada uno de los 6 log groups, todos alimentando la MISMA
      // métrica sin dimensión (crossTenantMetric, arriba) -- con dimensión
      // por servicio serían 18 métricas y rompería el presupuesto de §4 de
      // cost-model.md. El servicio concreto se recupera en Logs Insights
      // filtrando por `service` (campo no-dimensional del mismo log line).
      new logs.MetricFilter(this, `${name}CrossTenantAccessFilter`, {
        logGroup: service.logGroup,
        metricNamespace: SECURITY_NAMESPACE,
        metricName: 'CrossTenantAccessDenied',
        filterPattern: logs.FilterPattern.stringValue('$.event', '=', 'cross_tenant_access_denied'),
        metricValue: '1',
      });
    }

    // Una sola alarma sobre la métrica agregada (no una por servicio) --
    // cualquier acceso cross-tenant confirmado en cualquier proceso merece
    // la misma respuesta inmediata; el filtro por servicio es un paso del
    // runbook, no un criterio para decidir si suena o no.
    new AlarmWithRunbook(this, 'CrossTenantAccessAlarm', {
      runbook: 'alarma-acceso-cross-tenant.md',
      alarmName: `${prefix}-cross-tenant-access-denied`,
      alarmDescription: 'Al menos 1 acceso cross-tenant confirmado (amenaza #3 del threat model)',
      metric: crossTenantMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).alarm.addAlarmAction(securityAlarmAction);

    const dlqQueues = [
      { label: 'appointments-domain-events', queue: messaging.appointmentsDomainEventsQueue },
      { label: 'notifications-domain-events', queue: messaging.notificationsDomainEventsQueue },
      { label: 'appointment-expiration', queue: messaging.appointmentExpirationQueue },
      { label: 'appointment-reminders', queue: messaging.appointmentRemindersQueue },
      { label: 'appointment-noshow', queue: messaging.appointmentNoShowQueue },
    ];

    for (const { label, queue } of dlqQueues) {
      const dlqDepthMetric = queue.deadLetterQueue.metricApproximateNumberOfMessagesVisible();

      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: `DLQ ${label} — mensajes visibles`,
          left: [dlqDepthMetric],
          width: 8,
        }),
      );

      const dlqAlarm = new AlarmWithRunbook(this, `${label}DlqNotEmptyAlarm`, {
        runbook: 'alarma-dlq-no-vacia.md',
        alarmName: `${prefix}-dlq-${label}-no-vacia`,
        alarmDescription: `Al menos 1 mensaje visible en la DLQ física de ${label}`,
        metric: dlqDepthMetric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      }).alarm;
      dlqAlarm.addAlarmAction(alarmAction);
    }
  }
}
