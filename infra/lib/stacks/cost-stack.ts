import { Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ce from 'aws-cdk-lib/aws-ce';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';

export interface CostStackProps extends StackProps {
  config: EnvironmentConfig;
}

// Fase 6 (ADR-017): resuelve la pregunta abierta #1 de infra/README.md
// ("AWS::Budgets::Budget no existe en mx-central-1") sacando el Budget de
// la región, no adivinando -- Cost Anomaly Detection tampoco deja
// alternativa, su endpoint es únicamente us-east-1, así que este stack
// hermano (misma app, región distinta) hacía falta de todos modos.
//
// Topic de SNS propio en us-east-1 (no una referencia cross-stack al
// budgetAlarmTopic que existía en foundation-stack.ts, ahora eliminado):
// una referencia cross-region exigiría `crossRegionReferences: true`
// (Lambdas de custom resource para resolver el ARN en tiempo de deploy),
// complejidad innecesaria cuando este stack puede crear su propio topic.
//
// Excepción a ADR-010 (mx-central-1 como región única) documentada en
// ADR-017: metadatos de facturación no son datos personales de pacientes,
// y Budgets/Cost Explorer no tienen endpoint en mx-central-1 -- no hay
// alternativa que mantenga todo en una sola región.
export class CostStack extends Stack {
  public readonly costAlarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: CostStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.costAlarmTopic = new sns.Topic(this, 'CostAlarmTopic', {
      topicName: `clinica-${config.envName}-cost-alerts`,
      displayName: `Alertas de costo — ${config.envName}`,
    });

    // Suscripción de email NO se hardcodea aquí (evita comprometer un
    // correo real en el repo) -- paso manual post-deploy documentado en
    // infra/README.md: `aws sns subscribe --region us-east-1 --topic-arn
    // <arn> --protocol email --notification-endpoint <tu-email>`.

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetName: `clinica-${config.envName}-monthly`,
        budgetLimit: {
          amount: config.budgetLimitUsd,
          unit: 'USD',
        },
        costFilters: {
          TagKeyValue: [`user:Environment$${config.envName}`],
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.costAlarmTopic.topicArn }],
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.costAlarmTopic.topicArn }],
        },
        // FORECASTED (no solo ACTUAL): avisa ANTES de llegar al 100% si la
        // tendencia del mes lo proyecta -- el gate original (Fase 2) solo
        // reaccionaba después del hecho.
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.costAlarmTopic.topicArn }],
        },
      ],
    });

    // Monitor DIMENSIONAL sobre SERVICE: AWS rastrea automáticamente hasta
    // 5000 valores de este dimensión (cada servicio de AWS usado) y evalúa
    // cada uno independientemente -- útil para "un servicio de AWS
    // específico empezó a costar más de lo normal". Es de alcance de
    // cuenta completa (no filtrado por tag), así que desplegar este stack
    // en los 3 entornos crea 3 monitores equivalentes -- redundancia
    // aceptada (documentada en docs/cost/cost-model.md) a cambio de que
    // cada entorno tenga su propio ciclo de vida de stack independiente.
    const serviceMonitor = new ce.CfnAnomalyMonitor(this, 'ServiceAnomalyMonitor', {
      monitorName: `clinica-${config.envName}-service-anomaly-monitor`,
      monitorType: 'DIMENSIONAL',
      monitorDimension: 'SERVICE',
    });

    // Monitor CUSTOM filtrado al tag Environment de este entorno
    // específico -- este SÍ está scoped, a diferencia del anterior: agrupa
    // en un solo monitor todo el gasto etiquetado `Environment=<envName>`
    // (asumiendo que el tag ya fue activado como Cost Allocation Tag en
    // Billing, paso manual documentado en infra/README.md -- sin eso, el
    // monitor no vería ningún gasto).
    const environmentTagMonitor = new ce.CfnAnomalyMonitor(this, 'EnvironmentTagAnomalyMonitor', {
      monitorName: `clinica-${config.envName}-environment-tag-anomaly-monitor`,
      monitorType: 'CUSTOM',
      monitorSpecification: JSON.stringify({
        Tags: { Key: 'Environment', Values: [config.envName], MatchOptions: ['EQUALS'] },
      }),
    });

    new ce.CfnAnomalySubscription(this, 'AnomalySubscription', {
      subscriptionName: `clinica-${config.envName}-cost-anomaly`,
      frequency: 'IMMEDIATE',
      monitorArnList: [serviceMonitor.attrMonitorArn, environmentTagMonitor.attrMonitorArn],
      subscribers: [{ type: 'SNS', address: this.costAlarmTopic.topicArn }],
      // ThresholdExpression (no el campo `threshold`, deprecado) -- impacto
      // absoluto en USD, NO VERIFICADO contra patrones de gasto reales (ver
      // environments.ts, costAnomalyThresholdUsd).
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: [String(config.costAnomalyThresholdUsd)],
        },
      }),
    });
  }
}
