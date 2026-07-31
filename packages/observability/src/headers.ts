// Mismo nombre que ya usan los 5 servicios (services/*/src/lib/constants.ts)
// -- centralizado acá porque el gateway también lo necesita (Fase 6, cierra
// docs/backlog-deuda.md ítem 8) y debe ser byte-idéntico en los 6 procesos.
export const REQUEST_ID_HEADER = 'x-request-id' as const;

// Header que el ALB inyecta automáticamente en cada request (Root=1-...) y
// que aws-xray-sdk-core parsea para continuar (o iniciar) una traza.
export const XRAY_TRACE_HEADER = 'X-Amzn-Trace-Id' as const;
