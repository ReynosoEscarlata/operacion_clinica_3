import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface ClinicServiceProps {
  serviceName: string;
  vpc: ec2.Vpc;
  cluster: ecs.Cluster;
  repository: ecr.IRepository;
  containerPort: number;
  cpu: number;
  memoryLimitMiB: number;
  desiredCount: number;
  maxCapacity: number;
  environment: Record<string, string>;
  secrets?: Record<string, ecs.Secret>;
  /** Si se define, el servicio escala tambien por profundidad de esta cola SQS (ADR-014). */
  autoscalingQueue?: sqs.IQueue;
  alarmTopic?: sns.ITopic;
  removalPolicyIsDestroy: boolean;
}

// Construct reutilizable que encapsula task definition + service + target
// group + autoscaling + log group + alarmas base para un servicio Fargate,
// para no repetirlo 6 veces (mismo espiritu que ClinicService en el plan
// maestro Fase 2, y que el patron ya usado en el repo para
// event-consumer.ts/outbox-relay.ts: un archivo, misma logica, una instancia
// por servicio).
export class ClinicService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly taskSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: ClinicServiceProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/clinica/${props.serviceName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: props.removalPolicyIsDestroy ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: props.cpu,
      memoryLimitMiB: props.memoryLimitMiB,
    });

    taskDefinition.addContainer('Container', {
      containerName: props.serviceName,
      image: ecs.ContainerImage.fromEcrRepository(props.repository, 'latest'),
      portMappings: [{ containerPort: props.containerPort }],
      environment: props.environment,
      secrets: props.secrets,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: props.serviceName, logGroup }),
    });

    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSg', {
      vpc: props.vpc,
      description: `Security group de las tasks de ${props.serviceName}`,
      allowAllOutbound: true,
    });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition,
      desiredCount: props.desiredCount,
      securityGroups: [this.taskSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        name: props.serviceName,
      },
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
    });

    // Ningun target group se crea aqui. Solo el gateway se expone detras del
    // ALB publico (RFC-001 del Challenge 4: es el unico punto de entrada); su
    // target group se crea en edge-stack.ts, que llama a
    // `service.attachToApplicationTargetGroup(...)` sobre el `service`
    // expuesto por este construct. Crear el target group en el mismo stack
    // que el ALB/Listener (Edge) evita un ciclo real de CloudFormation entre
    // Compute y Edge (detectado al validar con `cdk synth`: adjuntar un
    // target group a un listener de otro stack crea una dependencia en
    // ambas direcciones si el target group vive en el stack del servicio).

    const scaling = this.service.autoScaleTaskCount({ maxCapacity: props.maxCapacity });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    if (props.autoscalingQueue) {
      scaling.scaleOnMetric('QueueDepthScaling', {
        metric: props.autoscalingQueue.metricApproximateNumberOfMessagesVisible(),
        scalingSteps: [
          { upper: 0, change: 0 },
          { lower: 10, change: +1 },
          { lower: 50, change: +2 },
        ],
        cooldown: Duration.seconds(60),
      });
    }

    // Alarma base de CPU (fundacion de la Fase 6, no las metricas RED
    // completas) — metrica propia del servicio ECS, no depende de que el
    // target group este atado a un load balancer. La alarma de "targets no
    // saludables" NO se crea aqui: `metricUnhealthyHostCount()` solo se puede
    // calcular una vez que el target group esta atado a un listener real, y
    // hoy solo el target group del gateway lo esta (edge-stack) — los otros
    // 5 servicios no se exponen detras del ALB publico (el gateway es el
    // unico punto de entrada, RFC-001 del Challenge 4). Esa alarma se crea en
    // edge-stack.ts, solo para el target group del gateway.
    const cpuAlarm = new cloudwatch.Alarm(this, 'HighCpuAlarm', {
      alarmName: `clinica-${props.serviceName}-high-cpu`,
      metric: this.service.metricCpuUtilization(),
      threshold: 85,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    if (props.alarmTopic) {
      cpuAlarm.addAlarmAction(new snsActions.SnsAction(props.alarmTopic));
    }
  }
}
