import { Stack, type StackProps, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as snsActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import { SERVICE_NAMES, type EnvironmentConfig, type ServiceName } from '../../config/environments.js';
import { AlarmWithRunbook } from '../constructs/alarm-with-runbook.js';

export interface DatabaseStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: ec2.Vpc;
  // Fase 6 (ADR-017): Foundation no depende de Database, así que pasarlo
  // desde bin/infra.ts no crea un ciclo -- mismo criterio ya usado para
  // Compute/Edge.
  alarmTopic: sns.ITopic;
}

const RDS_CPU_THRESHOLD_PERCENT = 80;
// Espacio libre mínimo como % del almacenamiento asignado -- convertido a
// bytes por instancia más abajo (cada servicio puede tener un
// allocatedStorageGb distinto en el futuro, aunque hoy todos comparten 20GB).
const RDS_FREE_STORAGE_MIN_PERCENT = 10;
// DBLoad (Performance Insights, ya habilitado) sobre el conteo de vCPUs de
// db.t4g.micro es la guía estándar de AWS para "la instancia está saturada
// de CPU/IO" -- 2 vCPUs en esta clase de instancia.
const RDS_DB_LOAD_THRESHOLD_VCPUS = 2;

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

      // Fase 6 (ADR-017): mismo tag ClinicService que compute-stack.ts --
      // la RDS de cada servicio es la otra mitad de su costo real (además
      // del Fargate), necesaria para el reporte de costo por tenant.
      Tags.of(instance).add('ClinicService', serviceName);

      const alarmAction = new snsActions.SnsAction(props.alarmTopic);
      const rdsRunbook = 'alarma-rds.md';

      new AlarmWithRunbook(this, `${serviceName}DbCpuAlarm`, {
        runbook: rdsRunbook,
        alarmName: `clinica-${config.envName}-rds-${serviceName}-cpu`,
        alarmDescription: `CPU de la RDS de ${serviceName} sobre ${RDS_CPU_THRESHOLD_PERCENT}%`,
        metric: instance.metricCPUUtilization(),
        threshold: RDS_CPU_THRESHOLD_PERCENT,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      }).alarm.addAlarmAction(alarmAction);

      const freeStorageThresholdBytes = sizing.allocatedStorageGb * 1024 * 1024 * 1024 * (RDS_FREE_STORAGE_MIN_PERCENT / 100);
      new AlarmWithRunbook(this, `${serviceName}DbFreeStorageAlarm`, {
        runbook: rdsRunbook,
        alarmName: `clinica-${config.envName}-rds-${serviceName}-free-storage`,
        alarmDescription: `Espacio libre de la RDS de ${serviceName} bajo ${RDS_FREE_STORAGE_MIN_PERCENT}% del almacenamiento asignado`,
        metric: instance.metricFreeStorageSpace(),
        threshold: freeStorageThresholdBytes,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      }).alarm.addAlarmAction(alarmAction);

      new AlarmWithRunbook(this, `${serviceName}DbConnectionsAlarm`, {
        runbook: rdsRunbook,
        alarmName: `clinica-${config.envName}-rds-${serviceName}-conexiones`,
        alarmDescription: `Conexiones activas de la RDS de ${serviceName} sobre ${sizing.maxConnectionsAlarmThreshold} (umbral NO VERIFICADO, ver environments.ts)`,
        metric: instance.metricDatabaseConnections(),
        threshold: sizing.maxConnectionsAlarmThreshold,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      }).alarm.addAlarmAction(alarmAction);

      // DBLoad no tiene un método helper en la L2 -- se referencia a mano
      // sobre el namespace AWS/RDS (requiere Performance Insights, ya
      // habilitado arriba).
      const dbLoadMetric = new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'DBLoad',
        dimensionsMap: { DBInstanceIdentifier: instance.instanceIdentifier },
        period: Duration.minutes(5),
        statistic: 'Average',
      });
      new AlarmWithRunbook(this, `${serviceName}DbLoadAlarm`, {
        runbook: rdsRunbook,
        alarmName: `clinica-${config.envName}-rds-${serviceName}-dbload`,
        alarmDescription: `DBLoad de ${serviceName} sobre ${RDS_DB_LOAD_THRESHOLD_VCPUS} vCPUs (Performance Insights) por 3 periodos`,
        metric: dbLoadMetric,
        threshold: RDS_DB_LOAD_THRESHOLD_VCPUS,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      }).alarm.addAlarmAction(alarmAction);

      databases[serviceName] = instance;
    }

    this.databases = databases;
    this.dbSecurityGroups = dbSecurityGroups;
  }
}
