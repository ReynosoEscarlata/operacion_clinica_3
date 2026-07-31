// Tipo mínimo para los handlers de eventos de dominio de este servicio --
// deliberadamente MÁS ANGOSTO que DomainEventEnvelope de @clinica/messaging
// (que además exige tenantId/publishedAt): Notifications todavía no tiene
// tenancy propia (ver runbook de migración de tenant_id, diferido a esta
// misma Fase 3b, paso posterior) y sus handlers solo necesitan payload. Un
// handler tipado así sigue siendo asignable a `Record<string, EventHandler>`
// de @clinica/messaging (contravarianza de parámetros: todo
// DomainEventEnvelope real cumple con esta forma más angosta).
export interface DomainEvent {
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;
