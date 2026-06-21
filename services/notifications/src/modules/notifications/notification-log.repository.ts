import type { PrismaClient } from '@prisma/client';

export interface NotificationLogRepository {
  record: (
    appointmentId: string,
    channel: string,
    type: string,
    status: 'SENT' | 'FAILED',
    error?: string,
  ) => Promise<void>;
  wasAlreadySent: (appointmentId: string, type: string) => Promise<boolean>;
}

export const buildNotificationLogRepository = (prisma: PrismaClient): NotificationLogRepository => ({
  record: async (appointmentId, channel, type, status, error) => {
    await prisma.notificationLog.create({
      data: { appointmentId, channel, type, status, error: error ?? null },
    });
  },
  // Idempotencia (PLAN.md Fase 3, punto 2: "mismo evento dos veces ≠ dos
  // correos"). Redis Streams es at-least-once: el mismo evento puede
  // entregarse de nuevo (ej. el proceso murió después de enviar el email
  // pero antes del XACK). La clave de deduplicación es (appointmentId,
  // type): cada tipo de email ocurre como máximo una vez en la vida de una
  // cita, porque la state machine de Appointments garantiza que cada
  // estado (PAID, CANCELLED, ...) se visita una sola vez.
  wasAlreadySent: async (appointmentId, type) => {
    const existing = await prisma.notificationLog.findFirst({
      where: { appointmentId, type, status: 'SENT' },
      select: { id: true },
    });
    return existing !== null;
  },
});
