import type { SNSClient } from '@aws-sdk/client-sns';
import type { PrismaClient } from '@prisma/client';
import { MissingTenantIdError, publishDomainEvent } from '@clinica/messaging';

import type { Logger } from './logger.js';

export interface OutboxRelayDeps {
  prisma: PrismaClient;
  snsClient: SNSClient;
  topicArn: string;
  logger: Logger;
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 50;

interface OutboxEventRow {
  id: string;
  tenantId: string | null;
  type: string;
  payload: unknown;
}

// Primer relay de Auth en su historia (Fase 3b, ADR-014 -- cierra
// docs/backlog-deuda.md ítem 6: UserCreated/UserDeactivated quedaban con
// publishedAt: null para siempre).
//
// Cross-tenant por diseño (job de sistema, no una request de un tenant
// particular): usa las funciones SECURITY DEFINER
// list_unpublished_outbox_events/mark_outbox_event_published (ver
// migration.sql) en vez de `prisma.outboxEvent.*` directo -- con FORCE ROW
// LEVEL SECURITY activo y sin ningún app.current_tenant seteado en esta
// conexión, una query directa nunca vería ninguna fila y el relay dejaría
// de publicar eventos en silencio (bug real encontrado al construir el
// equivalente en Payments/Doctors/Appointments).
export const runOutboxRelayOnce = async (deps: OutboxRelayDeps): Promise<number> => {
  const pending = await deps.prisma.$queryRaw<OutboxEventRow[]>`
    SELECT * FROM list_unpublished_outbox_events(${deps.batchSize ?? DEFAULT_BATCH_SIZE}::int)
  `;

  let published = 0;

  for (const event of pending) {
    try {
      await publishDomainEvent(deps.snsClient, deps.topicArn, {
        eventId: event.id,
        tenantId: event.tenantId,
        type: event.type,
        payload: event.payload as Record<string, unknown>,
      });
      await deps.prisma.$executeRaw`SELECT mark_outbox_event_published(${event.id}::uuid)`;
      published += 1;
    } catch (error) {
      // MissingTenantIdError: OutboxEvent.tenantId de Auth es nullable
      // (roles de plataforma, RFC-003) -- un evento sin tenant nunca se
      // publica (ADR-014), se loguea y se sigue con el resto del batch en
      // vez de abortarlo entero. No debería ocurrir en la práctica hoy
      // (create()/deactivate() siempre corren dentro de un tenant), es una
      // guarda defensiva.
      if (error instanceof MissingTenantIdError) {
        deps.logger.error({ err: error, eventId: event.id, type: event.type }, 'Evento sin tenantId, no se publica');
        continue;
      }
      throw error;
    }
  }

  if (published > 0) {
    deps.logger.info({ count: published }, 'Outbox relay: eventos publicados a SNS');
  }

  return published;
};

export const startOutboxRelay = (deps: OutboxRelayDeps, intervalMs = 2000): (() => void) => {
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    runOutboxRelayOnce(deps).catch((error: unknown) => {
      deps.logger.error({ err: error }, 'Error en el relay del Outbox');
    });
  };

  const timer = setInterval(tick, intervalMs);
  tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
};
