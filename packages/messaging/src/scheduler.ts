import { CreateScheduleCommand, type SchedulerClient } from '@aws-sdk/client-scheduler';

export interface CreateOneTimeScheduleInput {
  schedulerClient: SchedulerClient;
  groupName: string;
  name: string;
  executeAt: Date;
  targetArn: string;
  roleArn: string;
  input: Record<string, unknown>;
}

// Reemplaza el `delay` de BullMQ (`Queue.add(name, data, { delay })`): SQS
// DelaySeconds tiene un tope de 900s (15min), insuficiente para el delay de
// 30min de expiration y los ~24h de reminders -- de ahí EventBridge
// Scheduler. `actionAfterCompletion: 'DELETE'` es el equivalente de
// `removeOnComplete` de BullMQ (auto-limpieza, no queda un schedule
// "ejecutado" acumulándose).
export const createOneTimeSchedule = async (params: CreateOneTimeScheduleInput): Promise<void> => {
  // EventBridge Scheduler exige la expresión `at(...)` sin sufijo de
  // timezone/milisegundos -- se trunca a segundos en UTC.
  const isoWithoutMillis = params.executeAt.toISOString().replace(/\.\d+Z$/, '');

  await params.schedulerClient.send(
    new CreateScheduleCommand({
      Name: params.name,
      GroupName: params.groupName,
      ScheduleExpression: `at(${isoWithoutMillis})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: params.targetArn,
        RoleArn: params.roleArn,
        Input: JSON.stringify(params.input),
      },
    }),
  );
};
