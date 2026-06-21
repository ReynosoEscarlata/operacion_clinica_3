// Nombre del stream compartido por todos los servicios (Payments,
// Appointments, ...). Notifications no publica eventos propios (no tiene
// tabla OutboxEvent — ver x-events-published: [] en
// packages/contracts/notifications/openapi.yaml), así que este archivo
// solo expone la constante que también usa lib/event-consumer.ts, sin el
// lado productor del relay (ver services/appointments o services/payments
// para esa implementación, idéntica entre sí).
export const DOMAIN_EVENTS_STREAM = 'domain-events';
