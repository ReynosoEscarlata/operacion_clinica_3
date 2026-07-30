import { Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as snsActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import { CONTAINER_NAMES, type EnvironmentConfig } from '../../config/environments.js';
import type { ComputeStack } from './compute-stack.js';
import type { MessagingStack } from './messaging-stack.js';
import type { EdgeStack } from './edge-stack.js';

export interface ObservabilityStackProps extends StackProps {
  config: EnvironmentConfig;
  compute: ComputeStack;
  messaging: MessagingStack;
  edge: EdgeStack;
  operationalAlarmTopic: sns.ITopic;
}

// Fundacion de la Fase 6 (observabilidad y costos) — dashboards y alarmas
// base, NO las metricas RED completas por tenant que exige esa fase (eso
// requiere que exista tenant_id, Fase 3). Aqui: por-servicio (CPU, targets
// saludables) y por-cola (profundidad de dead-letter, la senal mas directa
// de "algo se esta reintentando sin exito").
export class ObservabilityStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { config, compute, messaging, edge, operationalAlarmTopic } = props;
    const prefix = `clinica-${config.envName}`;
    const alarmAction = new snsActions.SnsAction(operationalAlarmTopic);

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${prefix}-plataforma`,
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
    }

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

      const dlqAlarm = new cloudwatch.Alarm(this, `${label}DlqNotEmptyAlarm`, {
        alarmName: `${prefix}-dlq-${label}-no-vacia`,
        metric: dlqDepthMetric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
      dlqAlarm.addAlarmAction(alarmAction);
    }
  }
}
