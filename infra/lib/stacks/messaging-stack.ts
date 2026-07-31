import { Stack, type StackProps, Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';
import {
  APPOINTMENT_NOSHOW_SCAN_RATE_MINUTES,
  APPOINTMENT_SCHEDULE_GROUP_NAME_SUFFIX,
  MAX_RECEIVE_COUNTS,
} from '../../config/messaging-constants.js';
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
  // Grupo donde Appointments crea los one-time schedules de expiration/
  // reminders en runtime (ver services/appointments/src/queues/jobs/*.job.ts).
  public readonly appointmentScheduleGroup: scheduler.CfnScheduleGroup;
  public readonly appointmentScheduleGroupName: string;
  // Rol que asume scheduler.amazonaws.com al entregar tanto los one-time
  // schedules (expiration/reminders) como el recurrente de no-show -- un
  // solo rol para los 4, con permiso de SendMessage sobre las 3 colas.
  public readonly schedulerExecutionRole: iam.Role;

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
      maxReceiveCount: MAX_RECEIVE_COUNTS.domainEvents,
      visibilityTimeout: Duration.seconds(60),
    });

    this.notificationsDomainEventsQueue = new QueueWithDlq(this, 'NotificationsDomainEvents', {
      queueName: `${prefix}-notifications-domain-events`,
      maxReceiveCount: MAX_RECEIVE_COUNTS.domainEvents,
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
      maxReceiveCount: MAX_RECEIVE_COUNTS.appointmentExpiration,
    });

    // appointment-reminders: 3 intentos con backoff exponencial en el codigo
    // original — SQS no tiene backoff exponencial nativo por mensaje, se
    // aproxima con maxReceiveCount=3 y un visibilityTimeout mayor (la
    // implementacion de backoff real, si se necesita, se hace en el consumer
    // de la Fase 3 ajustando la visibilidad del mensaje en cada intento).
    this.appointmentRemindersQueue = new QueueWithDlq(this, 'AppointmentReminders', {
      queueName: `${prefix}-appointment-reminders`,
      maxReceiveCount: MAX_RECEIVE_COUNTS.appointmentReminders,
      visibilityTimeout: Duration.seconds(30),
    });

    // appointment-noshow: job repetible (cron cada 15 min en BullMQ) sin
    // reintentos — mismo criterio que expiration.
    this.appointmentNoShowQueue = new QueueWithDlq(this, 'AppointmentNoShow', {
      queueName: `${prefix}-appointment-noshow`,
      maxReceiveCount: MAX_RECEIVE_COUNTS.appointmentNoShow,
    });

    // Grupo de EventBridge Scheduler donde Appointments crea, en runtime, un
    // schedule "at()" por cita para expiration/reminders (ver
    // enqueueAppointmentExpiration/enqueueAppointmentReminder) -- reemplaza
    // el `delay` de BullMQ (SQS DelaySeconds tiene tope de 900s, insuficiente
    // para 30min/~24h, ADR-014).
    this.appointmentScheduleGroupName = `${prefix}-${APPOINTMENT_SCHEDULE_GROUP_NAME_SUFFIX}`;
    this.appointmentScheduleGroup = new scheduler.CfnScheduleGroup(this, 'AppointmentScheduleGroup', {
      name: this.appointmentScheduleGroupName,
    });

    // Un solo rol para los 4 schedules (3 one-time por cita + 1 recurrente de
    // no-show): todos entregan a una de las 3 colas de Appointments, nunca a
    // otro target.
    this.schedulerExecutionRole = new iam.Role(this, 'SchedulerExecutionRole', {
      roleName: `${prefix}-scheduler-execution-role`,
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    this.appointmentExpirationQueue.queue.grantSendMessages(this.schedulerExecutionRole);
    this.appointmentRemindersQueue.queue.grantSendMessages(this.schedulerExecutionRole);
    this.appointmentNoShowQueue.queue.grantSendMessages(this.schedulerExecutionRole);

    // Recurrente (rate, no at()) -- a diferencia de expiration/reminders,
    // esta es la unica pieza de Scheduler que es infraestructura estatica en
    // vez de creada en runtime: reemplaza el `repeat: { pattern: cron }` de
    // BullMQ. El body es systemJobEnvelopeSchema (solo `{ type }`, sin
    // tenantId -- el scan es cross-tenant por diseno, ver envelope.ts).
    new scheduler.CfnSchedule(this, 'AppointmentNoShowScanSchedule', {
      name: `${prefix}-appointment-noshow-scan`,
      groupName: this.appointmentScheduleGroup.name,
      scheduleExpression: `rate(${APPOINTMENT_NOSHOW_SCAN_RATE_MINUTES} minutes)`,
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: this.appointmentNoShowQueue.queue.queueArn,
        roleArn: this.schedulerExecutionRole.roleArn,
        input: JSON.stringify({ type: 'AppointmentNoShowScan' }),
      },
    }).addDependency(this.appointmentScheduleGroup);
  }
}
