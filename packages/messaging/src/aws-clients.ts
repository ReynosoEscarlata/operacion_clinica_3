import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

// En AWS real: sin `endpointUrl`/`accessKeyId`/`secretAccessKey`, el SDK usa
// la cadena de credenciales por defecto (rol de la tarea ECS) -- cero config
// explícita. En LocalStack/dev: todos los servicios necesitan el mismo
// override de endpoint + credenciales dummy, así que esta construcción es
// 100% mecánica e idéntica entre servicios (lo que varía es qué colas/
// topics se usan, no cómo se arma el cliente).
export interface AwsClientConfig {
  region: string;
  endpointUrl?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

const buildClientConfig = (
  config: AwsClientConfig,
): { region: string; endpoint?: string; credentials?: { accessKeyId: string; secretAccessKey: string } } => ({
  region: config.region,
  ...(config.endpointUrl ? { endpoint: config.endpointUrl } : {}),
  ...(config.accessKeyId && config.secretAccessKey
    ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
    : {}),
});

export const buildSnsClient = (config: AwsClientConfig): SNSClient => new SNSClient(buildClientConfig(config));

export const buildSqsClient = (config: AwsClientConfig): SQSClient => new SQSClient(buildClientConfig(config));

export const buildSchedulerClient = (config: AwsClientConfig): SchedulerClient =>
  new SchedulerClient(buildClientConfig(config));
