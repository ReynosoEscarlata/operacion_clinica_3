import { Stack, type StackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { Construct } from 'constructs';
import {
  SERVICE_NAMES,
  CONTAINER_NAMES,
  type ContainerName,
  type EnvironmentConfig,
  type ServiceName,
} from '../../config/environments.js';
import { MAX_RECEIVE_COUNTS } from '../../config/messaging-constants.js';
import { ClinicService } from '../constructs/clinic-service.js';
import { MessagingStack } from './messaging-stack.js';

// Puertos existentes hoy en docker-compose.yml — se conservan tal cual para
// que el traspaso de Docker Compose a Fargate no cambie ningun contrato.
const CONTAINER_PORTS: Record<ContainerName, number> = {
  gateway: 4000,
  auth: 4001,
  appointments: 4002,
  doctors: 4003,
  payments: 4004,
  notifications: 4005,
};

export interface ComputeStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: ec2.Vpc;
  databases: Record<ServiceName, rds.DatabaseInstance>;
  dbSecurityGroups: Record<ServiceName, ec2.SecurityGroup>;
  messaging: MessagingStack;
  alarmTopic: sns.ITopic;
}

export class ComputeStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly services: Record<ContainerName, ClinicService>;
  public readonly repositories: Record<ContainerName, ecr.Repository>;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { config, vpc, databases, dbSecurityGroups, messaging, alarmTopic } = props;
    const prefix = `clinica-${config.envName}`;

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${prefix}-cluster`,
      vpc,
      defaultCloudMapNamespace: {
        name: 'clinica.local',
        type: servicediscovery.NamespaceType.DNS_PRIVATE,
      },
      containerInsights: true,
    });

    // Un repositorio ECR por contenedor. Las imagenes reales se publican
    // fuera de esta fase (docker build + docker push manual, o el pipeline
    // de CI/CD de la Fase 9) — las task definitions referencian el tag
    // `:latest`, ver decision de diseno del plan de Fase 2.
    this.repositories = Object.fromEntries(
      CONTAINER_NAMES.map((name) => [
        name,
        new ecr.Repository(this, `${name}Repo`, {
          repositoryName: `${prefix}-${name}`,
          imageScanOnPush: true,
          removalPolicy: config.removalPolicy,
          emptyOnDelete: config.removalPolicy === RemovalPolicy.DESTROY,
        }),
      ]),
    ) as unknown as Record<ContainerName, ecr.Repository>;

    const cloudMapUrl = (name: ContainerName): string =>
      `http://${name}.clinica.local:${CONTAINER_PORTS[name]}`;

    const services = {} as Record<ContainerName, ClinicService>;

    // Los 5 servicios con estado (Postgres propio). NOTA sobre credenciales
    // de DB: RDS con `Credentials.fromGeneratedSecret` solo guarda
    // username/password en el secreto — host/port/dbname no son sensibles y
    // se pasan como variables de entorno planas. Esto significa que
    // `DATABASE_URL` como variable unica (la que hoy espera cada
    // `config/env.ts` de services/*, ver docs/baseline-challenge-4.md) NO se
    // arma automaticamente aqui: la Fase 3 debe actualizar el `env.ts` de
    // cada servicio para construir el connection string en runtime a partir
    // de DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, o introducir un paso de
    // bootstrap que lo haga antes de arrancar Prisma. Documentado tambien en
    // infra/README.md — no es un detalle silencioso.
    for (const serviceName of SERVICE_NAMES) {
      const db = databases[serviceName];
      const dbSecret = db.secret;
      if (!dbSecret) {
        throw new Error(`RDS de ${serviceName} no genero un secret de credenciales`);
      }

      const environment: Record<string, string> = {
        NODE_ENV: config.envName === 'prod' ? 'production' : 'development',
        PORT: String(CONTAINER_PORTS[serviceName]),
        LOG_LEVEL: config.envName === 'prod' ? 'info' : 'debug',
        DB_HOST: db.instanceEndpoint.hostname,
        DB_PORT: String(db.instanceEndpoint.port),
        DB_NAME: `${serviceName}_db`,
        // AWS_ENDPOINT_URL/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY se omiten
        // a proposito: en AWS real el SDK usa la cadena de credenciales por
        // defecto (el taskRole otorgado mas abajo), solo LocalStack/dev
        // necesita esos overrides (ver services/*/src/config/env.ts).
        AWS_REGION: config.region,
        // Fase 6 (ADR-017): EMF llega por el log driver `awslogs` que ya
        // existe (sin IAM nuevo) -- habilitado en todo despliegue real a
        // AWS (el default `false` de cada servicio es solo para que su
        // propia suite de tests no escupa documentos EMF por request).
        EMF_ENABLED: 'true',
        ENV_NAME: config.envName,
      };

      // Auth/Doctors/Payments solo producen (outbox-relay -> SNS).
      // Appointments/Notifications además consumen su propia cola. Los
      // grants de IAM se otorgan mas abajo, una vez creado el taskRole.
      if (serviceName === 'auth' || serviceName === 'doctors' || serviceName === 'payments') {
        environment.DOMAIN_EVENTS_TOPIC_ARN = messaging.domainEventsTopic.topicArn;
      }

      if (serviceName === 'notifications') {
        environment.NOTIFICATIONS_DOMAIN_EVENTS_QUEUE_URL = messaging.notificationsDomainEventsQueue.queue.queueUrl;
        environment.NOTIFICATIONS_DOMAIN_EVENTS_DLQ_URL =
          messaging.notificationsDomainEventsQueue.deadLetterQueue.queueUrl;
        environment.NOTIFICATIONS_DOMAIN_EVENTS_MAX_RECEIVE_COUNT = String(MAX_RECEIVE_COUNTS.domainEvents);
      }

      if (serviceName === 'appointments') {
        environment.DOCTORS_SERVICE_URL = cloudMapUrl('doctors');
        environment.PAYMENTS_SERVICE_URL = cloudMapUrl('payments');
        environment.DOMAIN_EVENTS_TOPIC_ARN = messaging.domainEventsTopic.topicArn;
        environment.APPOINTMENTS_DOMAIN_EVENTS_QUEUE_URL = messaging.appointmentsDomainEventsQueue.queue.queueUrl;
        environment.APPOINTMENTS_DOMAIN_EVENTS_DLQ_URL =
          messaging.appointmentsDomainEventsQueue.deadLetterQueue.queueUrl;
        environment.APPOINTMENTS_DOMAIN_EVENTS_MAX_RECEIVE_COUNT = String(MAX_RECEIVE_COUNTS.domainEvents);
        environment.APPOINTMENT_EXPIRATION_QUEUE_URL = messaging.appointmentExpirationQueue.queue.queueUrl;
        environment.APPOINTMENT_EXPIRATION_QUEUE_ARN = messaging.appointmentExpirationQueue.queue.queueArn;
        environment.APPOINTMENT_EXPIRATION_MAX_RECEIVE_COUNT = String(MAX_RECEIVE_COUNTS.appointmentExpiration);
        environment.APPOINTMENT_REMINDERS_QUEUE_URL = messaging.appointmentRemindersQueue.queue.queueUrl;
        environment.APPOINTMENT_REMINDERS_QUEUE_ARN = messaging.appointmentRemindersQueue.queue.queueArn;
        environment.APPOINTMENT_REMINDERS_DLQ_URL = messaging.appointmentRemindersQueue.deadLetterQueue.queueUrl;
        environment.APPOINTMENT_REMINDERS_MAX_RECEIVE_COUNT = String(MAX_RECEIVE_COUNTS.appointmentReminders);
        environment.APPOINTMENT_NOSHOW_QUEUE_URL = messaging.appointmentNoShowQueue.queue.queueUrl;
        environment.SCHEDULER_GROUP_NAME = messaging.appointmentScheduleGroupName;
        environment.SCHEDULER_EXECUTION_ROLE_ARN = messaging.schedulerExecutionRole.roleArn;
      }

      const clinicService = new ClinicService(this, `${serviceName}Service`, {
        serviceName,
        vpc,
        cluster: this.cluster,
        repository: this.repositories[serviceName],
        containerPort: CONTAINER_PORTS[serviceName],
        cpu: config.fargate[serviceName].cpu,
        memoryLimitMiB: config.fargate[serviceName].memoryLimitMiB,
        desiredCount: config.fargate[serviceName].desiredCount,
        maxCapacity: config.fargate[serviceName].maxCapacity,
        environment,
        secrets: {
          DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        },
        autoscalingQueue:
          serviceName === 'appointments' ? messaging.appointmentsDomainEventsQueue.queue : undefined,
        alarmTopic,
        removalPolicyIsDestroy: config.removalPolicy === RemovalPolicy.DESTROY,
      });

      // Grants de IAM (ADR-014) -- ninguno existia antes de Fase 3b. Cada
      // servicio recibe exactamente lo que necesita para su propio rol
      // (productor/consumidor), nunca acceso a las colas de otro servicio.
      if (serviceName === 'auth' || serviceName === 'doctors' || serviceName === 'payments') {
        messaging.domainEventsTopic.grantPublish(clinicService.taskRole);
      }

      if (serviceName === 'notifications') {
        messaging.notificationsDomainEventsQueue.queue.grantConsumeMessages(clinicService.taskRole);
        messaging.notificationsDomainEventsQueue.deadLetterQueue.grantConsumeMessages(clinicService.taskRole);
      }

      if (serviceName === 'appointments') {
        messaging.domainEventsTopic.grantPublish(clinicService.taskRole);
        messaging.appointmentsDomainEventsQueue.queue.grantConsumeMessages(clinicService.taskRole);
        messaging.appointmentsDomainEventsQueue.deadLetterQueue.grantConsumeMessages(clinicService.taskRole);
        messaging.appointmentExpirationQueue.queue.grantConsumeMessages(clinicService.taskRole);
        messaging.appointmentRemindersQueue.queue.grantConsumeMessages(clinicService.taskRole);
        messaging.appointmentRemindersQueue.deadLetterQueue.grantConsumeMessages(clinicService.taskRole);
        messaging.appointmentNoShowQueue.queue.grantConsumeMessages(clinicService.taskRole);

        // Crea los one-time schedules de expiration/reminders en runtime
        // (ver enqueueAppointmentExpiration/enqueueAppointmentReminder) --
        // scoped al ARN del propio grupo, nunca scheduler:* genérico.
        clinicService.taskRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ['scheduler:CreateSchedule'],
            resources: [
              `arn:aws:scheduler:${config.region}:${config.account}:schedule/${messaging.appointmentScheduleGroupName}/*`,
            ],
          }),
        );
        // EventBridge Scheduler exige que quien crea el schedule pueda pasarle
        // su propio execution role al servicio (iam:PassRole) -- sin esto,
        // CreateSchedule falla en runtime aunque el rol ya exista.
        clinicService.taskRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [messaging.schedulerExecutionRole.roleArn],
          }),
        );
      }

      // Regla de seguridad: la task de este servicio es el UNICO origen
      // permitido hacia su propia RDS (plan maestro Fase 2, requisito de
      // security group de RDS). Se usa `CfnSecurityGroupIngress` explicito en
      // vez de `dbSecurityGroups[serviceName].addIngressRule(...)` a
      // proposito: ese metodo agregaria la regla como parte del recurso SG
      // que vive en DatabaseStack, y como esa regla referencia el SG de la
      // task (ComputeStack), CloudFormation crearia una dependencia inversa
      // Database->Compute — ciclo real detectado al validar con `cdk synth`
      // (Compute ya depende de Database para endpoint/secret). Declarando la
      // regla aqui, en ComputeStack, la dependencia queda en una sola
      // direccion (Compute->Database, la que ya existe).
      new ec2.CfnSecurityGroupIngress(this, `${serviceName}DbIngress`, {
        groupId: dbSecurityGroups[serviceName].securityGroupId,
        ipProtocol: 'tcp',
        fromPort: db.instanceEndpoint.port,
        toPort: db.instanceEndpoint.port,
        sourceSecurityGroupId: clinicService.taskSecurityGroup.securityGroupId,
        description: `Trafico desde las tasks de ${serviceName}`,
      });

      services[serviceName] = clinicService;
    }

    // Gateway: sin Postgres propio (stateless, ver baseline). Necesita las
    // URLs internas (Cloud Map) de los 5 servicios + JWKS de Auth.
    services.gateway = new ClinicService(this, 'gatewayService', {
      serviceName: 'gateway',
      vpc,
      cluster: this.cluster,
      repository: this.repositories.gateway,
      containerPort: CONTAINER_PORTS.gateway,
      cpu: config.fargate.appointments.cpu,
      memoryLimitMiB: config.fargate.appointments.memoryLimitMiB,
      desiredCount: config.fargate.appointments.desiredCount,
      maxCapacity: config.fargate.appointments.maxCapacity,
      environment: {
        NODE_ENV: config.envName === 'prod' ? 'production' : 'development',
        PORT: String(CONTAINER_PORTS.gateway),
        LOG_LEVEL: config.envName === 'prod' ? 'info' : 'debug',
        AUTH_JWKS_URL: `${cloudMapUrl('auth')}/v1/auth/.well-known/jwks.json`,
        AUTH_SERVICE_URL: cloudMapUrl('auth'),
        APPOINTMENTS_SERVICE_URL: cloudMapUrl('appointments'),
        DOCTORS_SERVICE_URL: cloudMapUrl('doctors'),
        PAYMENTS_SERVICE_URL: cloudMapUrl('payments'),
        NOTIFICATIONS_SERVICE_URL: cloudMapUrl('notifications'),
        EMF_ENABLED: 'true',
        ENV_NAME: config.envName,
      },
      alarmTopic,
      removalPolicyIsDestroy: config.removalPolicy === ('destroy' as never),
    });

    this.services = services;
  }
}
