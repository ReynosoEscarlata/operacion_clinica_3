import { Stack, type StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';
import { SERVICE_NAMES, type EnvironmentConfig, type ServiceName } from '../../config/environments.js';

export interface DatabaseStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: ec2.Vpc;
}

export class DatabaseStack extends Stack {
  public readonly databases: Record<ServiceName, rds.DatabaseInstance>;
  public readonly dbSecurityGroups: Record<ServiceName, ec2.SecurityGroup>;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, vpc } = props;

    const kmsKey = new kms.Key(this, 'RdsKmsKey', {
      alias: `clinica-${config.envName}-rds`,
      description: 'CMK compartida para las 5 instancias RDS por servicio (ADR-005/ADR-013)',
      enableKeyRotation: true,
      removalPolicy: config.removalPolicy,
    });

    // Parameter group compartido: rds.force_ssl obliga TLS en cada conexión
    // (regla explícita del plan maestro Fase 2); log_connections prepara el
    // terreno de auditoría de la Fase 3/5. Ninguna bandera especial de RLS
    // hace falta aquí — Row Level Security (ADR-006) se habilita por tabla
    // con DDL, no por parámetro de instancia.
    const parameterGroup = new rds.ParameterGroup(this, 'PostgresParams', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      parameters: {
        'rds.force_ssl': '1',
        log_connections: '1',
      },
    });

    const databases = {} as Record<ServiceName, rds.DatabaseInstance>;
    const dbSecurityGroups = {} as Record<ServiceName, ec2.SecurityGroup>;

    for (const serviceName of SERVICE_NAMES) {
      const sizing = config.rds[serviceName];

      const securityGroup = new ec2.SecurityGroup(this, `${serviceName}DbSg`, {
        vpc,
        securityGroupName: `clinica-${config.envName}-${serviceName}-db`,
        description: `Solo acepta trafico desde el security group de las tasks de ${serviceName}`,
        allowAllOutbound: false,
      });
      dbSecurityGroups[serviceName] = securityGroup;

      const instance = new rds.DatabaseInstance(this, `${serviceName}Db`, {
        instanceIdentifier: `clinica-${config.envName}-${serviceName}`,
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [securityGroup],
        multiAz: sizing.multiAz,
        allocatedStorage: sizing.allocatedStorageGb,
        storageType: rds.StorageType.GP3,
        storageEncrypted: true,
        storageEncryptionKey: kmsKey,
        credentials: rds.Credentials.fromGeneratedSecret(`${serviceName}_app`, {
          secretName: `clinica-${config.envName}-${serviceName}-db-credentials`,
        }),
        databaseName: `${serviceName}_db`,
        parameterGroup,
        backupRetention: Duration.days(config.envName === 'prod' ? 14 : 7),
        deleteAutomatedBackups: config.removalPolicy === RemovalPolicy.DESTROY,
        removalPolicy: config.removalPolicy,
        enablePerformanceInsights: true,
        deletionProtection: config.envName === 'prod',
      });

      // Rotacion de credenciales (backlog item 9 de Fase 0: la llave JWT de
      // Auth vive en memoria; esto no es lo mismo, pero establece el patron
      // de rotacion gestionada por Secrets Manager que el resto del sistema
      // de credenciales deberia seguir).
      instance.addRotationSingleUser({ automaticallyAfter: Duration.days(30) });

      databases[serviceName] = instance;
    }

    this.databases = databases;
    this.dbSecurityGroups = dbSecurityGroups;
  }
}
