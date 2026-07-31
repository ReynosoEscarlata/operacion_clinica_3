import { Stack, type StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';

export interface FoundationStackProps extends StackProps {
  config: EnvironmentConfig;
}

// Adaptación de ADR-009 (una sola cuenta AWS con 3 entornos lógicos, no AWS
// Organizations): esta stack reemplaza lo que el plan maestro llamaba "landing
// zone" (Organizations, SCPs, IAM Identity Center). Sin límite de cuenta entre
// entornos, la fundación mínima que sí aplica es: un CloudTrail de cuenta
// única (no organizacional) para auditoría, y un Budget con alerta desde el
// día 1 (mitigación explícita del riesgo "factura de AWS inesperada" de la
// sección 6 del plan maestro). El aislamiento de entorno se logra por tag y
// naming, aplicado globalmente en bin/infra.ts, no por esta stack.
export class FoundationStack extends Stack {
  public readonly budgetAlarmTopic: sns.Topic;
  public readonly operationalAlarmTopic: sns.Topic;
  public readonly securityAlarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const { config } = props;

    const trailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      bucketName: `clinica-${config.envName}-cloudtrail-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: config.removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'expire-viejos',
          transitions: [{ storageClass: s3.StorageClass.GLACIER, transitionAfter: Duration.days(90) }],
        },
      ],
    });

    // Trail de cuenta única (isOrganizationTrail no aplica sin Organizations).
    new cloudtrail.Trail(this, 'CloudTrail', {
      trailName: `clinica-${config.envName}-trail`,
      bucket: trailBucket,
      isMultiRegionTrail: false,
      enableFileValidation: true,
      sendToCloudWatchLogs: true,
    });

    // Sin límite de cuenta entre entornos, el borrado accidental de este
    // trail o de sus logs es exactamente la amenaza de Repudiation #9 del
    // threat model aplicada a nivel de infraestructura — el bucket nunca debe
    // aceptar borrado público (BLOCK_ALL ya lo cubre) y su remoción sigue la
    // política de remoción del entorno (RETAIN en prod).

    this.budgetAlarmTopic = new sns.Topic(this, 'BudgetAlarmTopic', {
      topicName: `clinica-${config.envName}-budget-alerts`,
      displayName: `Alertas de presupuesto — ${config.envName}`,
    });

    // Suscripción de email NO se hardcodea aquí (evita comprometer un correo
    // real en el repo) — se documenta en infra/README.md como paso manual
    // post-deploy: `aws sns subscribe --topic-arn <arn> --protocol email
    // --notification-endpoint <tu-email>`.

    // Topic de alarmas operativas (CPU, targets no saludables, DLQ no vacía)
    // — separado del de presupuesto porque son audiencias distintas (equipo
    // de guardia vs. quien controla el gasto). Se crea aquí, en la primera
    // stack del stack de dependencias, porque compute-stack y
    // observability-stack ambas lo necesitan y esto evita una dependencia
    // circular entre ellas.
    this.operationalAlarmTopic = new sns.Topic(this, 'OperationalAlarmTopic', {
      topicName: `clinica-${config.envName}-operational-alerts`,
      displayName: `Alertas operativas — ${config.envName}`,
    });

    // Topic de seguridad (Fase 6, ADR-017) -- misma lógica que ya separó
    // budgetAlarmTopic de operationalAlarmTopic: un acceso cross-tenant
    // confirmado es un posible incidente LFPDPPP (Ley Federal de Protección
    // de Datos Personales en Posesión de los Particulares), audiencia
    // distinta de "algo se cayó" (guardia técnica). Se suscribe a mano
    // post-deploy, igual que budgetAlarmTopic (infra/README.md).
    this.securityAlarmTopic = new sns.Topic(this, 'SecurityAlarmTopic', {
      topicName: `clinica-${config.envName}-security-alerts`,
      displayName: `Alertas de seguridad — ${config.envName}`,
    });

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
          subscribers: [{ subscriptionType: 'SNS', address: this.budgetAlarmTopic.topicArn }],
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.budgetAlarmTopic.topicArn }],
        },
      ],
    });
  }
}
