import { App, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { getEnvironmentConfig } from '../config/environments.js';
import { FoundationStack } from './stacks/foundation-stack.js';
import { NetworkStack } from './stacks/network-stack.js';
import { DatabaseStack } from './stacks/database-stack.js';
import { MessagingStack } from './stacks/messaging-stack.js';
import { StorageStack } from './stacks/storage-stack.js';
import { IdentityStack } from './stacks/identity-stack.js';
import { ComputeStack } from './stacks/compute-stack.js';
import { EdgeStack } from './stacks/edge-stack.js';
import { ObservabilityStack } from './stacks/observability-stack.js';
import { CostStack } from './stacks/cost-stack.js';

// Extraído de bin/infra.ts (Fase 6, ADR-017): infra/test/alarmas-tienen-runbook.test.ts
// necesita construir el mismo árbol de stacks para inspeccionar sus
// templates via `Template.fromStack` -- sin esta función, el test tendría
// que duplicar el wiring completo de dependencias entre stacks, con el
// riesgo de que ambas copias diverjan silenciosamente.
//
// `envNameOverride` es para el test (que quiere "dev"/"staging"/"prod"
// explícito, sin depender del contexto `-c env=` de la CLI de cdk); cuando
// se omite, se lee del contexto de la nueva App -- `-c env=` de la CLI
// llega vía la variable de entorno CDK_CONTEXT_JSON, que cualquier `new
// App()` lee por igual, no importa cuál instancia se construya primero.
export const buildApp = (envNameOverride?: string): App => {
  const app = new App();
  const envName = envNameOverride ?? (app.node.tryGetContext('env') as string | undefined) ?? 'dev';
  const config = getEnvironmentConfig(envName);

  const env = { account: config.account, region: config.region };
  const stackPrefix = `Clinica-${config.envName}`;

  const foundation = new FoundationStack(app, `${stackPrefix}-Foundation`, { env, config });

  const network = new NetworkStack(app, `${stackPrefix}-Network`, { env, config });

  const database = new DatabaseStack(app, `${stackPrefix}-Database`, {
    env,
    config,
    vpc: network.vpc,
    alarmTopic: foundation.operationalAlarmTopic,
  });

  const messaging = new MessagingStack(app, `${stackPrefix}-Messaging`, { env, config });

  const storage = new StorageStack(app, `${stackPrefix}-Storage`, { env, config });

  const identity = new IdentityStack(app, `${stackPrefix}-Identity`, { env, config });

  const compute = new ComputeStack(app, `${stackPrefix}-Compute`, {
    env,
    config,
    vpc: network.vpc,
    databases: database.databases,
    dbSecurityGroups: database.dbSecurityGroups,
    messaging,
    alarmTopic: foundation.operationalAlarmTopic,
  });

  const edge = new EdgeStack(app, `${stackPrefix}-Edge`, {
    env,
    config,
    vpc: network.vpc,
    compute,
    alarmTopic: foundation.operationalAlarmTopic,
  });

  const observability = new ObservabilityStack(app, `${stackPrefix}-Observability`, {
    env,
    config,
    compute,
    messaging,
    edge,
    operationalAlarmTopic: foundation.operationalAlarmTopic,
    securityAlarmTopic: foundation.securityAlarmTopic,
  });

  // us-east-1, no `config.region` (mx-central-1) -- ver el comentario en
  // cost-stack.ts: ni Budgets ni Cost Anomaly Detection existen fuera de
  // us-east-1. Sin dependencias de otros stacks (topic propio), así que no
  // necesita `crossRegionReferences` ni un orden particular.
  const cost = new CostStack(app, `${stackPrefix}-Cost`, {
    env: { account: config.account, region: 'us-east-1' },
    config,
  });

  // Regla de seguridad ALB -> gateway, creada aqui (no dentro de EdgeStack ni
  // de ComputeStack) y parenteada bajo `compute`: mantiene la dependencia
  // cross-stack en una sola direccion (Compute->Edge, la misma que ya crea
  // `attachToApplicationTargetGroup` en EdgeStack) — ver comentario en
  // edge-stack.ts para el ciclo real que esto evita.
  new ec2.CfnSecurityGroupIngress(compute, 'GatewayIngressFromAlb', {
    groupId: compute.services.gateway.taskSecurityGroup.securityGroupId,
    ipProtocol: 'tcp',
    fromPort: 4000,
    toPort: 4000,
    sourceSecurityGroupId: edge.albSecurityGroup.securityGroupId,
    description: 'Trafico desde el ALB',
  });

  // Tags obligatorias a nivel de app (DoD de la Fase 2: "Todo recurso
  // etiquetado"). ManagedBy=IaC deja explicito que ningun recurso de esta app
  // se creo a mano en la consola.
  Tags.of(app).add('Environment', config.envName);
  Tags.of(app).add('CostCenter', 'clinica-scheduler');
  Tags.of(app).add('ManagedBy', 'IaC');
  Tags.of(app).add('Service', 'clinica-scheduler-platform');

  // Fase 6 (ADR-017): tag `Component` por stack -- junto con `ClinicService`
  // (por servicio, ver compute-stack.ts/database-stack.ts), es el segundo
  // eje de desglose que docs/cost/reporte-costo-por-tenant.md necesita para
  // separar costo fijo de plataforma (red, mensajería) del costo atribuible
  // a un servicio concreto.
  Tags.of(foundation).add('Component', 'foundation');
  Tags.of(network).add('Component', 'network');
  Tags.of(database).add('Component', 'database');
  Tags.of(messaging).add('Component', 'messaging');
  Tags.of(storage).add('Component', 'storage');
  Tags.of(identity).add('Component', 'identity');
  Tags.of(compute).add('Component', 'compute');
  Tags.of(edge).add('Component', 'edge');
  Tags.of(observability).add('Component', 'observability');
  Tags.of(cost).add('Component', 'cost');

  return app;
};
