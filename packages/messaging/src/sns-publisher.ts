import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';

import { domainEventEnvelopeSchema, MissingTenantIdError, type DomainEventEnvelope } from './envelope.js';

export interface PublishDomainEventInput {
  eventId: string;
  tenantId: string | null;
  type: string;
  payload: Record<string, unknown>;
}

// Reemplaza el `XADD domain-events ...` de Redis Streams. Valida el
// envelope ANTES de publicar -- un evento sin tenantId nunca sale (ADR-014:
// "nunca procesarlo por si acaso" aplica igual de estricto al publicar que
// al consumir). El caller (outbox-relay de cada servicio) atrapa
// MissingTenantIdError por evento dentro del loop del batch, no alrededor
// de todo el batch.
export const publishDomainEvent = async (
  snsClient: SNSClient,
  topicArn: string,
  input: PublishDomainEventInput,
): Promise<void> => {
  if (!input.tenantId) {
    throw new MissingTenantIdError(
      `Evento ${input.type} (${input.eventId}) sin tenantId -- no se publica`,
    );
  }

  const envelope: DomainEventEnvelope = domainEventEnvelopeSchema.parse({
    eventId: input.eventId,
    tenantId: input.tenantId,
    type: input.type,
    payload: input.payload,
    publishedAt: new Date().toISOString(),
  });

  await snsClient.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(envelope),
    }),
  );
};
