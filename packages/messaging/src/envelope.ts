import { z } from 'zod';

// Contrato de mensaje compartido por los 5 servicios (ADR-014): tenantId
// NUNCA es opcional -- un evento sin tenant no se publica (ver
// sns-publisher.ts) y un mensaje sin tenant al consumir jamás llega a un
// handler (ver sqs-consumer.ts, va directo a dead-letter).
export const domainEventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.record(z.unknown()),
  publishedAt: z.string().datetime(),
});

export type DomainEventEnvelope = z.infer<typeof domainEventEnvelopeSchema>;

// Excepción documentada: el job recurrente de no-show (AppointmentNoShowScan)
// es inherentemente cross-tenant -- escanea todos los tenants por diseño
// (misma función SECURITY DEFINER que ya usaba el cron de BullMQ). Se le da
// su propio schema minúsculo en vez de forzar un caso especial dentro de la
// regla general "tenantId siempre requerido".
export const systemJobEnvelopeSchema = z.object({
  type: z.string().min(1),
});

export type SystemJobEnvelope = z.infer<typeof systemJobEnvelopeSchema>;

export class MissingTenantIdError extends Error {}

export class InvalidEnvelopeError extends Error {
  constructor(public readonly validationError: unknown) {
    super('El mensaje no cumple con el contrato de envelope de eventos de dominio');
  }
}

export const parseEnvelope = (raw: unknown): DomainEventEnvelope => {
  const result = domainEventEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidEnvelopeError(result.error);
  }
  return result.data;
};

export const parseSystemJobEnvelope = (raw: unknown): SystemJobEnvelope => {
  const result = systemJobEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidEnvelopeError(result.error);
  }
  return result.data;
};
