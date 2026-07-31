import type pino from 'pino';

// Re-exportado (no una instancia propia): cada servicio ya tiene su propio
// logger Pino configurado (nivel, mixin de requestId/tenantId) -- este
// paquete solo necesita el TIPO para aceptar ese logger como dependencia.
export type Logger = pino.Logger;
