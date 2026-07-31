import { DeleteMessageCommand, ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { parseSystemJobEnvelope } from '@clinica/messaging';

import type { Logger } from '../../lib/logger.js';
import { requestContextStorage } from '../../lib/request-context.js';
import { runWithTenant } from '../../lib/tenant-context.js';
import type { AppointmentRepository } from '../../modules/appointments/appointments.repository.js';
import type { AppointmentStateMachine } from '../../modules/appointments/state-machine.js';

export const APPOINTMENT_NOSHOW_SCAN_EVENT_TYPE = 'AppointmentNoShowScan';

export interface NoShowWorkerDeps {
  appointmentRepository: AppointmentRepository;
  stateMachine: AppointmentStateMachine;
  logger: Logger;
}

export interface NoShowJobData {
  executedAt: string;
}

// Job de sistema, cross-tenant por naturaleza (escanea TODOS los tenants
// buscando candidatos vencidos) -- ver
// listRemindedBefore/list_reminded_appointments_before (SECURITY DEFINER),
// que devuelve solo id+tenantId, nunca la fila completa. Cada candidato se
// procesa DENTRO de su propio runWithTenant antes de leer/escribir
// cualquier otro dato -- nunca se opera con dos tenants mezclados en la
// misma operación.
export const processNoShowJob = async (data: NoShowJobData, deps: NoShowWorkerDeps): Promise<void> => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const candidates = await deps.appointmentRepository.listRemindedBefore(oneHourAgo);

  if (candidates.length === 0) {
    deps.logger.info({ jobExecutedAt: data.executedAt }, 'No hay citas para marcar como no-show');
    return;
  }

  for (const candidate of candidates) {
    try {
      await runWithTenant(candidate.tenantId, async () => {
        const current = await deps.appointmentRepository.findStatusById(candidate.id);

        if (current !== 'REMINDED') {
          deps.logger.info(
            { appointmentId: candidate.id, currentStatus: current },
            'Cita ignorada: ya pasó de estado REMINDED',
          );
          return;
        }

        await deps.stateMachine.transition(candidate.id, 'NO_SHOW', { trigger: 'noshow-cron' });

        deps.logger.info({ appointmentId: candidate.id }, 'Cita marcada como NO_SHOW automáticamente');
      });
    } catch (error) {
      deps.logger.error({ err: error, appointmentId: candidate.id }, 'Error al marcar cita como NO_SHOW');
    }
  }

  deps.logger.info(
    { processedCount: candidates.length, jobExecutedAt: data.executedAt },
    'Job de no-show completado',
  );
};

export interface NoShowConsumerDeps extends NoShowWorkerDeps {
  sqsClient: SQSClient;
  queueUrl: string;
  waitTimeSeconds?: number;
}

const DEFAULT_WAIT_TIME_SECONDS = 10;
const DEFAULT_MAX_MESSAGES = 10;

// A diferencia de las otras colas de eventos de dominio, esta NO usa el
// consumer genérico de @clinica/messaging: el trigger recurrente (rate(15
// minutes), infra estática -- ver PLAN.md CDK) no tiene tenantId (es
// cross-tenant por diseño, ver systemJobEnvelopeSchema en envelope.ts). El
// job en sí nunca lanza (cada candidato atrapa su propio error, ver arriba)
// y no tiene estrategia de reintento/dead-letter (CLAUDE.md: 1 intento, sin
// dead-letter) -- si un mensaje llega corrupto, se loguea y se borra: la
// siguiente ejecución del cron 15 minutos después vuelve a escanear todo.
export const pollNoShowQueueOnce = async (deps: NoShowConsumerDeps): Promise<number> => {
  const result = await deps.sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: deps.queueUrl,
      MaxNumberOfMessages: DEFAULT_MAX_MESSAGES,
      WaitTimeSeconds: deps.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS,
    }),
  );

  const messages = result.Messages ?? [];
  let processed = 0;

  for (const message of messages) {
    try {
      const envelope = parseSystemJobEnvelope(JSON.parse(message.Body ?? '{}'));
      if (envelope.type === APPOINTMENT_NOSHOW_SCAN_EVENT_TYPE) {
        await requestContextStorage.run({ requestId: `noshow-${Date.now()}` }, () =>
          processNoShowJob({ executedAt: new Date().toISOString() }, deps),
        );
        processed += 1;
      } else {
        deps.logger.warn({ type: envelope.type }, 'Mensaje con tipo desconocido en la cola de no-show, se ignora');
      }
    } catch (error) {
      deps.logger.error({ err: error, body: message.Body }, 'Mensaje inválido en la cola de no-show, se descarta');
    }

    if (message.ReceiptHandle) {
      await deps.sqsClient.send(new DeleteMessageCommand({ QueueUrl: deps.queueUrl, ReceiptHandle: message.ReceiptHandle }));
    }
  }

  return processed;
};

export const startNoShowConsumer = (deps: NoShowConsumerDeps): (() => void) => {
  let stopped = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await pollNoShowQueueOnce(deps);
      } catch (error) {
        deps.logger.error({ err: error }, 'Error en el consumer de no-show');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  void loop();

  return () => {
    stopped = true;
  };
};
