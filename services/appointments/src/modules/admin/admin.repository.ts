import type { PrismaClient } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { writeOutboxEvent } from '../../lib/outbox.js';
import type { DeadLetterRepository } from '../../lib/dead-letter.repository.js';

export interface AdminRepository {
  // "Reintentar" un evento en dead-letter no reinyecta el mensaje viejo al
  // stream (Redis Streams no permite re-escribir un ID ya entregado) —
  // escribe un OutboxEvent nuevo con el mismo type/payload, que el relay va
  // a publicar como una entrada fresca, y borra la entrada de dead-letter.
  // Todo en una transacción: o se reintenta y se borra, o ninguna de las
  // dos (nunca queremos perder el registro sin haber reintentado).
  retryDeadLetterEntry: (id: string) => Promise<void>;
}

export const buildAdminRepository = (
  prisma: PrismaClient,
  deadLetterRepository: DeadLetterRepository,
): AdminRepository => ({
  retryDeadLetterEntry: async (id) => {
    const entry = await deadLetterRepository.findById(id);
    if (!entry) {
      throw new AppError(404, 'DEAD_LETTER_NOT_FOUND', 'Entrada de dead-letter no encontrada');
    }

    await prisma.$transaction(async (tx) => {
      await writeOutboxEvent(tx, entry.eventType, entry.payload as Record<string, unknown>);
      await tx.deadLetterEntry.delete({ where: { id } });
    });
  },
});
