import type { EventHandler } from '@clinica/messaging';

import { AppError } from '../../lib/app-error.js';
import type { DeadLetterRepository } from '../../lib/dead-letter.repository.js';

export interface AdminRepository {
  retryDeadLetterEntry: (id: string) => Promise<void>;
}

// "Reintentar" una entrada re-invoca el MISMO handler que hubiera corrido el
// consumer real (el mapa `handlers` construido en server.ts, ver
// domain-event-handlers.ts), con el payload que quedó guardado en la
// entrada de dead-letter -- ya no republica un OutboxEvent nuevo (ADR-014
// unifica este mecanismo con el que ya usaba Notifications: Redis Streams
// no permitía reinyectar un ID ya entregado, pero eso ya no aplica). Si
// vuelve a fallar, la entrada NO se borra (se puede reintentar de nuevo) y
// el error se relanza tal cual.
export const buildAdminRepository = (
  deadLetterRepository: DeadLetterRepository,
  handlers: Record<string, EventHandler>,
): AdminRepository => ({
  retryDeadLetterEntry: async (id) => {
    const entry = await deadLetterRepository.findById(id);
    if (!entry) {
      throw new AppError(404, 'DEAD_LETTER_NOT_FOUND', 'Entrada de dead-letter no encontrada');
    }

    const handler = handlers[entry.eventType];
    if (!handler) {
      throw new AppError(
        422,
        'NO_HANDLER_FOR_EVENT_TYPE',
        `No hay handler registrado para el tipo de evento ${entry.eventType}`,
      );
    }

    await handler({
      eventId: entry.eventId,
      tenantId: entry.tenantId,
      type: entry.eventType,
      payload: entry.payload as Record<string, unknown>,
      publishedAt: entry.failedAt.toISOString(),
    });

    await deadLetterRepository.remove(id);
  },
});
