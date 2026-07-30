export const REQUEST_ID_HEADER = 'x-request-id' as const;

// Poblado por el gateway (JWT verificado) cuando la llamada viene de un
// admin/staff autenticado, o directamente por Appointments (llamada
// servicio-a-servicio, sin pasar por el gateway) al crear un PaymentIntent
// dentro de su propio TenantContext ya resuelto. A diferencia de
// Auth/Doctors/Appointments, ningún endpoint de Payments exige este header
// -- es contexto opcional que enriquece el metadata de Stripe (ver
// payments.service.ts) para que el webhook pueda resolver el tenant después
// sin volver a consultar a Appointments (RFC-001, cero estado compartido).
export const TENANT_ID_HEADER = 'x-internal-tenant-id' as const;
