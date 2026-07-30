import { Stack, type StackProps, Duration } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';
import { QueueWithDlq } from '../constructs/queue-with-dlq.js';

export interface MessagingStackProps extends StackProps {
  config: EnvironmentConfig;
}

// ADR-014: toda la mensajeria migra a SQS + SNS, reemplazando por completo
// Redis Streams (domain-events) y las 3 colas BullMQ que hoy corren dentro
// del proceso de Appointments (docs/baseline-challenge-4.md seccion 3). El
// mapeo 1:1 con lo que existe hoy:
//   - stream "domain-events"      -> topic SNS "domain-events" + 1 cola SQS
//                                    por consumer group actual (appointments,
//                                    notifications)
//   - cola BullMQ appointment-expiration -> cola SQS homonima
//   - cola BullMQ appointment-reminders  -> cola SQS homonima
//   - cola BullMQ appointment-noshow     -> cola SQS homonima
// La reescritura del codigo de aplicacion que hoy usa event-consumer.ts /
// outbox-relay.ts / BullMQ.Queue es trabajo de la Fase 3, no de esta fase de
// infra pura.
export class MessagingStack extends Stack {
  public readonly domainEventsTopic: sns.Topic;
  public readonly appointmentsDomainEventsQueue: QueueWithDlq;
  public readonly notificationsDomainEventsQueue: QueueWithDlq;
  public readonly appointmentExpirationQueue: QueueWithDlq;
  public readonly appointmentRemindersQueue: QueueWithDlq;
  public readonly appointmentNoShowQueue: QueueWithDlq;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    const { config } = props;
    const prefix = `clinica-${config.envName}`;

    this.domainEventsTopic = new sns.Topic(this, 'DomainEventsTopic', {
      topicName: `${prefix}-domain-events`,
      displayName: 'Eventos de dominio (AppointmentCreated, PaymentSucceeded, etc.)',
    });

    // maxReceiveCount=5: mismo default que ya usaba event-consumer.ts en Redis
    // Streams (SPEC.md, 2026-06-21) antes de mandar a dead-letter.
    this.appointmentsDomainEventsQueue = new QueueWithDlq(this, 'AppointmentsDomainEvents', {
      queueName: `${prefix}-appointments-domain-events`,
      maxReceiveCount: 5,
      visibilityTimeout: Duration.seconds(60),
    });

    this.notificationsDomainEventsQueue = new QueueWithDlq(this, 'NotificationsDomainEvents', {
      queueName: `${prefix}-notifications-domain-events`,
      maxReceiveCount: 5,
      visibilityTimeout: Duration.seconds(60),
    });

    this.domainEventsTopic.addSubscription(
      new subscriptions.SqsSubscription(this.appointmentsDomainEventsQueue.queue, {
        rawMessageDelivery: true,
      }),
    );
    this.domainEventsTopic.addSubscription(
      new subscriptions.SqsSubscription(this.notificationsDomainEventsQueue.queue, {
        rawMessageDelivery: true,
      }),
    );

    // appointment-expiration: 1 intento, sin reintento en el codigo original
    // (CLAUDE.md, tabla de colas) — maxReceiveCount=1 preserva esa semantica:
    // si falla la primera vez, va a dead-letter en vez de reintentar (el cron
    // repeatable original recogia el siguiente intento en su proxima corrida,
    // no esta cola).
    this.appointmentExpirationQueue = new QueueWithDlq(this, 'AppointmentExpiration', {
      queueName: `${prefix}-appointment-expiration`,
      maxReceiveCount: 1,
    });

    // appointment-reminders: 3 intentos con backoff exponencial en el codigo
    // original — SQS no tiene backoff exponencial nativo por mensaje, se
    // aproxima con maxReceiveCount=3 y un visibilityTimeout mayor (la
    // implementacion de backoff real, si se necesita, se hace en el consumer
    // de la Fase 3 ajustando la visibilidad del mensaje en cada intento).
    this.appointmentRemindersQueue = new QueueWithDlq(this, 'AppointmentReminders', {
      queueName: `${prefix}-appointment-reminders`,
      maxReceiveCount: 3,
      visibilityTimeout: Duration.seconds(30),
    });

    // appointment-noshow: job repetible (cron cada 15 min en BullMQ) sin
    // reintentos — mismo criterio que expiration.
    this.appointmentNoShowQueue = new QueueWithDlq(this, 'AppointmentNoShow', {
      queueName: `${prefix}-appointment-noshow`,
      maxReceiveCount: 1,
    });
  }
}
