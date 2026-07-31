# @clinica/observability

Paquete compartido de Fase 6 (ADR-017) entre los 5 servicios de dominio y el
`gateway` -- igual que `@clinica/authz`, este código debe ser byte-idéntico
en los 6 procesos, por eso vive en un paquete y no se duplica 5×.

## Reglas de emisión (no negociables)

Al emitir cualquier anotación de X-Ray, línea EMF, o evento de seguridad:

1. **Nunca `request.url` cruda.** Solo `request.routeOptions.url` (el
   patrón, ej. `/v1/appointments/:id`). Este repo tiene
   `GET /v1/patients/by-email?email=...` -- loguear la URL cruda filtraría
   un email a CloudWatch. No es un riesgo teórico.
2. **Nunca query strings ni body.**
3. **Nunca una fila completa de un recurso** en un evento de seguridad --
   solo IDs opacos (UUID) y metadatos de actor/recurso.

La redacción real de PII en logs es entregable de Fase 5, no de este
paquete -- ver el comentario `// TODO Fase 5: redact` en cada
`src/lib/logger.ts` de los servicios.

## Presupuesto de métricas custom

Las dimensiones de EMF son **siempre `[Service, Environment]`, nunca**
`route` ni `tenantId`. `docs/cost/cost-model.md` §3.5 ya comprometió 60
métricas custom (~$18/mes) en el Gate 1 -- una dimensión adicional que
escale con el número de rutas o de tenants rompe ese número. El desglose
por tenant/ruta se hace vía CloudWatch Logs Insights sobre las propiedades
no-dimensionales del mismo documento EMF (gratis), nunca como dimensión de
métrica.

## Qué exporta

- `xray-plugin.ts` (`registerXray`): registra `aws-xray-sdk-fastify`
  (modo manual) + anota `tenantId`/`requestId`/`route` en el segmento.
- `emf.ts` (`emitRequestMetrics`): emite RED (RequestCount/RequestLatency/
  ErrorCount) vía el logger Pino existente de cada servicio -- Pino mergea
  las claves en la raíz de la línea, que es el shape que CloudWatch exige
  para extraer una métrica de un log estructurado.
- `security-events.ts` (`logCrossTenantAccessDenied`, `logAuthzDenied`):
  forma canónica de las líneas que alimentan los CloudWatch Logs Metric
  Filter de `infra/lib/stacks/observability-stack.ts` -- un metric filter
  matchea un shape exacto, así que este shape sale de un solo lugar.
