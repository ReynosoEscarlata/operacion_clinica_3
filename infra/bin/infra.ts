#!/usr/bin/env node
import 'source-map-support/register.js';
import { App, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { getEnvironmentConfig } from '../config/environments.js';
import { FoundationStack } from '../lib/stacks/foundation-stack.js';
import { NetworkStack } from '../lib/stacks/network-stack.js';
import { DatabaseStack } from '../lib/stacks/database-stack.js';
import { MessagingStack } from '../lib/stacks/messaging-stack.js';
import { StorageStack } from '../lib/stacks/storage-stack.js';
import { IdentityStack } from '../lib/stacks/identity-stack.js';
import { ComputeStack } from '../lib/stacks/compute-stack.js';
import { EdgeStack } from '../lib/stacks/edge-stack.js';
import { ObservabilityStack } from '../lib/stacks/observability-stack.js';

const app = new App();

// `-c env=dev|staging|prod`, default dev. ADR-009: una sola cuenta AWS, 3
// entornos logicos (no Organizations) — el entorno se selecciona por
// contexto de CDK, no por cuenta/perfil de AWS distinto.
const envName = (app.node.tryGetContext('env') as string | undefined) ?? 'dev';
const config = getEnvironmentConfig(envName);

const env = { account: config.account, region: config.region };
const stackPrefix = `Clinica-${config.envName}`;

const foundation = new FoundationStack(app, `${stackPrefix}-Foundation`, { env, config });

const network = new NetworkStack(app, `${stackPrefix}-Network`, { env, config });

const database = new DatabaseStack(app, `${stackPrefix}-Database`, {
  env,
  config,
  vpc: network.vpc,
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

// Referencias para evitar que TypeScript marque estos bindings como no
// usados cuando su unico proposito es fijar el orden de dependencia de CDK
// (storage/identity/edge/observability no se re-exportan mas alla de este
// archivo).
void storage;
void identity;
void edge;
void observability;

// Tags obligatorias a nivel de app (DoD de la Fase 2: "Todo recurso
// etiquetado"). ManagedBy=IaC deja explicito que ningun recurso de esta app
// se creo a mano en la consola.
Tags.of(app).add('Environment', config.envName);
Tags.of(app).add('CostCenter', 'clinica-scheduler');
Tags.of(app).add('ManagedBy', 'IaC');
// El tag "Service" se aplica por stack, no globalmente (cada stack cubre un
// dominio distinto: red, datos, compute, etc.) — ver `Tags.of(<stack>)` en
// cada archivo de lib/stacks si se necesita granularidad adicional; el
// default aqui cubre el requisito minimo de DoD sin repetirlo por stack.
Tags.of(app).add('Service', 'clinica-scheduler-platform');
