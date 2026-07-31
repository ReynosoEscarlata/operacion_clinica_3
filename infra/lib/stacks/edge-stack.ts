import { Stack, type StackProps, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as snsActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';
import { AlarmWithRunbook } from '../constructs/alarm-with-runbook.js';
import { SecureBucket } from '../constructs/secure-bucket.js';
import type { ComputeStack } from './compute-stack.js';

// Umbrales de latencia/error rate del ALB -- NO VERIFICADO contra tráfico
// real (no existe todavía, ver docs/baseline-challenge-4.md): valores de
// arranque razonables para una API REST, a recalibrar con datos de
// producción (ADR-017, sección "cosas a monitorear").
const ALB_5XX_THRESHOLD = 10;
const ALB_LATENCY_P95_SECONDS = 2;

export interface EdgeStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: ec2.Vpc;
  compute: ComputeStack;
  alarmTopic: sns.ITopic;
}

// El unico punto de entrada publico es el gateway (RFC-001 del Challenge 4:
// reverse proxy + verificacion JWT). El ALB reenvia TODO el trafico al
// target group del gateway; el gateway enruta internamente hacia los 5
// servicios via Cloud Map (compute-stack). Los target groups de los otros 5
// servicios existen (creados en ClinicService) pero NO se exponen en este
// listener publico — solo alcanzables dentro de la VPC.
export class EdgeStack extends Stack {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly gatewayTargetGroup: elbv2.ApplicationTargetGroup;
  public readonly albSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const { config, vpc, compute } = props;
    const prefix = `clinica-${config.envName}`;

    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'Trafico HTTP publico hacia el ALB',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP publico');

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `${prefix}-alb`,
      vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // La regla de ingress que permite trafico del ALB hacia el SG de las
    // tasks del gateway NO se crea aqui: dado que ya existe una dependencia
    // Compute->Edge (por el target group, ver mas abajo), crear esa regla en
    // este stack referenciando el SG de Compute produciria Edge->Compute y
    // cerraria un ciclo. Se crea en bin/infra.ts, parenteada bajo el stack de
    // Compute, despues de que ambos stacks existen — mantiene la
    // dependencia en una sola direccion (Compute->Edge).

    // El target group del gateway se crea AQUI (no en ClinicService/Compute)
    // para que quede en el mismo stack que el ALB/Listener — adjuntar un
    // ecs.FargateService de otro stack a un target group+listener de este
    // stack, en cualquier combinacion donde el target group viva en Compute,
    // produce un ciclo real de CloudFormation (detectado al validar con
    // `cdk synth`: Compute->Edge por la espera del listener, Edge->Compute
    // por la referencia al target group). Creando el target group aqui, la
    // unica dependencia nueva queda en una direccion: Compute (el recurso
    // ECS Service) depende de que este listener exista, y Edge no necesita
    // nada de Compute para crear el target group en si (solo para llamar
    // `attachToApplicationTargetGroup` sobre el objeto `service` ya creado).
    this.gatewayTargetGroup = new elbv2.ApplicationTargetGroup(this, 'GatewayTargetGroup', {
      vpc,
      port: 4000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
      },
    });
    compute.services.gateway.service.attachToApplicationTargetGroup(this.gatewayTargetGroup);

    // TODO (pregunta abierta, ver infra/README.md): no hay dominio/ACM cert
    // decidido todavia para este challenge, asi que el listener es HTTP:80,
    // no HTTPS:443. Migrar a HTTPS es un cambio de una lista de listener +
    // certificado ACM una vez que exista un dominio, no un rediseno.
    this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.gatewayTargetGroup],
    });

    const gatewayUnhealthyAlarm = new AlarmWithRunbook(this, 'GatewayUnhealthyTargetsAlarm', {
      runbook: 'alarma-targets-no-saludables.md',
      alarmName: `${prefix}-gateway-unhealthy-targets`,
      alarmDescription: 'Al menos 1 target del gateway no saludable por 2 periodos seguidos',
      metric: this.gatewayTargetGroup.metricUnhealthyHostCount(),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    }).alarm;
    gatewayUnhealthyAlarm.addAlarmAction(new snsActions.SnsAction(props.alarmTopic));

    // ALB 5xx (ELB-level: errores del propio balanceador, ej. rechazos por
    // WAF o timeouts al target) -- treatMissingData NOT_BREACHING en las 3
    // alarmas EMF/ALB nuevas de esta ola: sin tráfico real todavía, cada
    // deploy nacería en ALARM/INSUFFICIENT_DATA antes del primer request.
    const alb5xxAlarm = new AlarmWithRunbook(this, 'Alb5xxAlarm', {
      runbook: 'alarma-error-rate-5xx.md',
      alarmName: `${prefix}-alb-5xx`,
      alarmDescription: `Más de ${ALB_5XX_THRESHOLD} respuestas 5xx del ALB en 5 minutos`,
      metric: this.loadBalancer.metricHttpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: ALB_5XX_THRESHOLD,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).alarm;
    alb5xxAlarm.addAlarmAction(new snsActions.SnsAction(props.alarmTopic));

    // Target 5xx (errores devueltos por el gateway mismo, no por el ALB) --
    // mismo runbook, distinguible en la consola por el nombre de la alarma.
    const gatewayTarget5xxAlarm = new AlarmWithRunbook(this, 'GatewayTarget5xxAlarm', {
      runbook: 'alarma-error-rate-5xx.md',
      alarmName: `${prefix}-gateway-error-rate-5xx`,
      alarmDescription: `Más de ${ALB_5XX_THRESHOLD} respuestas 5xx del gateway en 5 minutos`,
      metric: this.gatewayTargetGroup.metricHttpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: ALB_5XX_THRESHOLD,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).alarm;
    gatewayTarget5xxAlarm.addAlarmAction(new snsActions.SnsAction(props.alarmTopic));

    const albLatencyP95Alarm = new AlarmWithRunbook(this, 'AlbLatencyP95Alarm', {
      runbook: 'alarma-latencia-p95.md',
      alarmName: `${prefix}-alb-latencia-p95`,
      alarmDescription: `p95 de tiempo de respuesta del gateway sobre ${ALB_LATENCY_P95_SECONDS}s por 3 periodos`,
      metric: this.gatewayTargetGroup.metricTargetResponseTime({
        period: Duration.minutes(5),
        statistic: 'p95',
      }),
      threshold: ALB_LATENCY_P95_SECONDS,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).alarm;
    albLatencyP95Alarm.addAlarmAction(new snsActions.SnsAction(props.alarmTopic));

    // Anomalía de tráfico: la L2 `cloudwatch.Alarm` no soporta
    // ANOMALY_DETECTION_BAND (requiere una expresión de métrica que la L2
    // no expone) -- se usa el L1 `CfnAlarm` directo, con
    // LessThanLowerOrGreaterThanUpperThreshold contra la banda calculada.
    // Bandas de anomalía necesitan datos históricos para calibrarse; sin
    // tráfico real todavía esta alarma es más una fundación que una señal
    // útil hoy (documentado en ADR-017, "cosas a monitorear").
    new cloudwatch.CfnAlarm(this, 'AlbTrafficAnomalyAlarm', {
      alarmName: `${prefix}-alb-anomalia-trafico`,
      alarmDescription: `Runbook: docs/runbooks/alarma-error-rate-5xx.md — volumen de requests del ALB fuera de la banda esperada (anomaly detection)`,
      comparisonOperator: 'LessThanLowerOrGreaterThanUpperThreshold',
      evaluationPeriods: 3,
      treatMissingData: 'notBreaching',
      metrics: [
        {
          id: 'm1',
          metricStat: {
            metric: {
              namespace: 'AWS/ApplicationELB',
              metricName: 'RequestCount',
              dimensions: [{ name: 'LoadBalancer', value: this.loadBalancer.loadBalancerFullName }],
            },
            period: 300,
            stat: 'Sum',
          },
        },
        {
          id: 'ad1',
          expression: 'ANOMALY_DETECTION_BAND(m1, 2)',
        },
      ],
      thresholdMetricId: 'ad1',
      alarmActions: [props.alarmTopic.topicArn],
    });

    // Access logs del ALB (plan maestro Fase 2, punto 9) -- ningun bucket de
    // storage-stack.ts es reusable (cada uno tiene un proposito especifico
    // de ADR-013), asi que se crea uno nuevo aqui. `logAccessLogs` agrega
    // la bucket policy del delivery account de ELB para la region via el
    // mapeo interno de aws-cdk-lib/region-info -- si la region no tuviera
    // entrada ahi, `cdk synth` fallaria con un error explicito (no
    // silencioso). us-east-1 (ADR-018) tiene entrada solida en ese mapeo --
    // la incertidumbre real era con mx-central-1 (ADR-010, reemplazado),
    // region nueva de AWS.
    const albAccessLogsBucket = new SecureBucket(this, 'AlbAccessLogsBucket', {
      bucketName: `${prefix}-alb-access-logs`,
      removalPolicy: config.removalPolicy,
    });
    this.loadBalancer.logAccessLogs(albAccessLogsBucket.bucket);

    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `${prefix}-waf`,
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${prefix}-waf`,
      },
      rules: [
        {
          name: 'AWS-AWSManagedRulesCommonRuleSet',
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
          },
        },
        {
          name: 'AWS-AWSManagedRulesSQLiRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesSQLiRuleSet' },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'SQLiRuleSet',
          },
        },
        {
          name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesKnownBadInputsRuleSet' },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'KnownBadInputsRuleSet',
          },
        },
        {
          // Rate limiting por IP (plan maestro Fase 2, punto 9). Rate
          // limiting POR TENANT (no solo por IP) requiere leer el claim del
          // JWT dentro de una regla WAF custom, que no es directo con
          // reglas administradas — queda como trabajo de la Fase 3/6 a nivel
          // de aplicacion (middleware), documentado en infra/README.md.
          name: 'RateLimitPorIp',
          priority: 3,
          action: { block: {} },
          statement: {
            rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitPorIp',
          },
        },
      ],
    });

    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: this.loadBalancer.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    // Logging completo de WAF (plan maestro Fase 2, punto 9 -- pendiente
    // hasta ahora). El nombre del bucket DEBE empezar con `aws-waf-logs-`
    // -- requisito duro de la API, no una convención (CfnLoggingConfiguration
    // falla en deploy si no calza). Redacta authorization/cookie: son los
    // dos headers con mayor probabilidad de contener credenciales/sesión
    // entre los que WAF samplea en las requests bloqueadas.
    const wafLogsBucket = new SecureBucket(this, 'WafLogsBucket', {
      bucketName: `aws-waf-logs-${prefix}`,
      removalPolicy: config.removalPolicy,
    });
    const wafLogging = new wafv2.CfnLoggingConfiguration(this, 'WafLogging', {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [wafLogsBucket.bucket.bucketArn],
      redactedFields: [{ singleHeader: { name: 'authorization' } }, { singleHeader: { name: 'cookie' } }],
    });
    // Bug conocido del codegen L1 de `CfnLoggingConfiguration` (verificado
    // con `cdk synth`, CFN-Validate F3002/F3003): `SingleHeaderProperty.name`
    // se serializa en minúscula en el template ("name"), pero la API real
    // de WAFv2 exige "Name" con mayúscula para este campo anidado
    // específico (a diferencia de la convención PascalCase que CDK aplica
    // en el resto del recurso) -- sin este override, el logging de
    // redacción fallaría o se ignoraría en un deploy real.
    wafLogging.addPropertyOverride('RedactedFields', [
      { SingleHeader: { Name: 'authorization' } },
      { SingleHeader: { Name: 'cookie' } },
    ]);
  }
}
