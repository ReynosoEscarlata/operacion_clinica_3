import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';

export interface NetworkStackProps extends StackProps {
  config: EnvironmentConfig;
}

export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `clinica-${config.envName}-vpc`,
      // AZs explicitas (no `maxAzs`): con una cuenta ficticia de contexto
      // para `cdk synth` sin credenciales reales (ver config/environments.ts
      // y infra/README.md), `maxAzs` dispara un lookup de contexto contra
      // AWS real para resolver cuantas AZs tiene la cuenta/region, lo cual
      // falla sin credenciales. Nombres de AZ siguiendo el patron estandar
      // de AWS (a/b/c) — a re-verificar contra la consola real antes del
      // primer deploy real (ver preguntas abiertas del README).
      availabilityZones: [`${config.region}a`, `${config.region}b`, `${config.region}c`],
      natGateways: config.natGateways,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // VPC endpoints (ahorro real de NAT, ver plan maestro Fase 2 punto 2):
    // el tráfico de las tasks de Fargate hacia S3/SQS/Secrets Manager no sale
    // a Internet vía NAT si estos endpoints existen.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });

    this.vpc.addInterfaceEndpoint('SqsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SQS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
  }
}
