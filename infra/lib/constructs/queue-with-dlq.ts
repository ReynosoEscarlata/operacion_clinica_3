import { Duration } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface QueueWithDlqProps {
  queueName: string;
  /** Intentos antes de mover a dead-letter. */
  maxReceiveCount: number;
  visibilityTimeout?: Duration;
  /** Retención de mensajes en la cola principal. Default 4 días (igual que el default de SQS). */
  retentionPeriod?: Duration;
}

// Construct reutilizable: cola SQS + su dead-letter queue, con la política de
// reintentos como parámetro explícito (ADR-014: reemplaza el patrón de
// XAUTOCLAIM/maxAttempts de Redis Streams por el mecanismo nativo de SQS
// redrive policy — mismo concepto, otro mecanismo).
export class QueueWithDlq extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: QueueWithDlqProps) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, 'Dlq', {
      queueName: `${props.queueName}-dlq`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: props.queueName,
      visibilityTimeout: props.visibilityTimeout ?? Duration.seconds(30),
      retentionPeriod: props.retentionPeriod ?? Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: props.maxReceiveCount,
      },
    });
  }
}
