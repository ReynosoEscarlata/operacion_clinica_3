import type { DeadLetterEntry } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import type { EventHandler } from '../../lib/event-consumer.js';
import type { DeadLetterRepository } from './dead-letter.repository.js';

export class DeadLetterService {
  constructor(
    private readonly repository: DeadLetterRepository,
    private readonly handlers: Record<string, EventHandler>,
  ) {}

  list(): Promise<DeadLetterEntry[]> {
    return this.repository.list();
  }

  // Reintentar acá no republica nada a Redis Streams (Notifications es
  // consumer, no dueño de estos eventos) — re-ejecuta el mismo handler que
  // hubiera corrido el consumer real, con el payload que quedó guardado en
  // la entrada de dead-letter. Si vuelve a fallar, la entrada NO se borra
  // (se puede reintentar de nuevo) y se relanza el error tal cual.
  async retry(id: string): Promise<void> {
    const entry = await this.repository.findById(id);
    if (!entry) {
      throw new AppError(404, 'DEAD_LETTER_NOT_FOUND', 'Entrada de dead-letter no encontrada');
    }

    const handler = this.handlers[entry.eventType];
    if (!handler) {
      throw new AppError(
        422,
        'NO_HANDLER_FOR_EVENT_TYPE',
        `No hay handler registrado para el tipo de evento ${entry.eventType}`,
      );
    }

    await handler({ eventId: entry.eventId, type: entry.eventType, payload: entry.payload as Record<string, unknown> });
    await this.repository.remove(id);
  }

  async remove(id: string): Promise<void> {
    const entry = await this.repository.findById(id);
    if (!entry) {
      throw new AppError(404, 'DEAD_LETTER_NOT_FOUND', 'Entrada de dead-letter no encontrada');
    }
    await this.repository.remove(id);
  }
}

export const buildDeadLetterService = (
  repository: DeadLetterRepository,
  handlers: Record<string, EventHandler>,
): DeadLetterService => new DeadLetterService(repository, handlers);
