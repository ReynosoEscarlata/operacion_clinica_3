import { Stack, type StackProps, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as snsActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';
import type { ComputeStack } from './compute-stack.js';

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

    const gatewayUnhealthyAlarm = new cloudwatch.Alarm(this, 'GatewayUnhealthyTargetsAlarm', {
      alarmName: `${prefix}-gateway-unhealthy-targets`,
      metric: this.gatewayTargetGroup.metricUnhealthyHostCount(),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    gatewayUnhealthyAlarm.addAlarmAction(new snsActions.SnsAction(props.alarmTopic));

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
  }
}
