// Aprovisiona en LocalStack los recursos de mensajería que
// infra/lib/stacks/messaging-stack.ts define para AWS real (Fase 3b,
// ADR-014) -- pero NO reutiliza el CDK: CDK sintetiza CloudFormation para
// un deploy real, esto es un fixture de test liviano con el SDK de AWS
// directo. Los números de maxReceiveCount están duplicados a mano desde
// messaging-stack.ts (infra/ y scripts/ son proyectos npm separados, sin
// workspace en común) -- si cambian ahí, cambian aquí también.
import {
  CreateTopicCommand,
  SNSClient,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  CreateScheduleGroupCommand,
  SchedulerClient,
} from '@aws-sdk/client-scheduler';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const region = process.env.AWS_REGION ?? 'us-east-1';
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };

const sns = new SNSClient({ endpoint, region, credentials });
const sqs = new SQSClient({ endpoint, region, credentials });
const scheduler = new SchedulerClient({ endpoint, region, credentials });

const PREFIX = 'clinica-test';
const SCHEDULE_GROUP_NAME = `${PREFIX}-appointment-schedules`;

// Igual que infra/lib/stacks/messaging-stack.ts.
const QUEUES = [
  { name: `${PREFIX}-appointments-domain-events`, maxReceiveCount: 5, subscribeToDomainEvents: true },
  { name: `${PREFIX}-notifications-domain-events`, maxReceiveCount: 5, subscribeToDomainEvents: true },
  { name: `${PREFIX}-appointment-expiration`, maxReceiveCount: 1, subscribeToDomainEvents: false },
  { name: `${PREFIX}-appointment-reminders`, maxReceiveCount: 3, subscribeToDomainEvents: false },
  { name: `${PREFIX}-appointment-noshow`, maxReceiveCount: 1, subscribeToDomainEvents: false },
];

const getQueueArn = async (queueUrl) => {
  const attrs = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
  );
  return attrs.Attributes.QueueArn;
};

// CreateQueue es idempotente por nombre (devuelve la URL existente si ya
// existe con los mismos atributos) -- a diferencia de CreateSchedule más
// abajo.
const createQueueWithDlq = async (name, maxReceiveCount) => {
  const dlq = await sqs.send(new CreateQueueCommand({ QueueName: `${name}-dlq` }));
  const dlqArn = await getQueueArn(dlq.QueueUrl);

  const main = await sqs.send(
    new CreateQueueCommand({
      QueueName: name,
      Attributes: {
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount }),
      },
    }),
  );
  const mainArn = await getQueueArn(main.QueueUrl);

  return { queueUrl: main.QueueUrl, queueArn: mainArn, dlqUrl: dlq.QueueUrl, dlqArn };
};

const run = async () => {
  console.log(`Aprovisionando LocalStack en ${endpoint} (region ${region})...`);

  const topic = await sns.send(new CreateTopicCommand({ Name: `${PREFIX}-domain-events` }));
  console.log('SNS topic:', topic.TopicArn);

  for (const queueConfig of QUEUES) {
    const queue = await createQueueWithDlq(queueConfig.name, queueConfig.maxReceiveCount);
    console.log(`SQS queue: ${queueConfig.name} -> ${queue.queueUrl} (DLQ: ${queue.dlqUrl})`);

    if (queueConfig.subscribeToDomainEvents) {
      await sns.send(
        new SubscribeCommand({
          TopicArn: topic.TopicArn,
          Protocol: 'sqs',
          Endpoint: queue.queueArn,
          Attributes: { RawMessageDelivery: 'true' },
        }),
      );
      console.log(`  suscrita a ${topic.TopicArn} (rawMessageDelivery)`);
    }
  }

  // CreateScheduleGroup NO es idempotente (a diferencia de CreateQueue/
  // CreateTopic) -- ignora el conflicto si ya existe de una corrida previa.
  try {
    await scheduler.send(new CreateScheduleGroupCommand({ Name: SCHEDULE_GROUP_NAME }));
    console.log('Schedule group creado:', SCHEDULE_GROUP_NAME);
  } catch (error) {
    if (error.name === 'ConflictException') {
      console.log('Schedule group ya existía:', SCHEDULE_GROUP_NAME);
    } else {
      throw error;
    }
  }

  console.log('LocalStack aprovisionado correctamente.');
};

run().catch((error) => {
  console.error('Error aprovisionando LocalStack:', error);
  process.exit(1);
});
