# ADR-014: Estrategia de mensajería (SQS vs. mantener Redis/BullMQ vs. coexistencia)

**Fecha:** 2026-07-29
**Estado:** Propuesto — **PENDIENTE DE DECISIÓN HUMANA**
**Decisor(es):** Ricardo Reynoso

## Contexto

Redis Streams (broker de eventos de dominio, `domain-events`) y BullMQ (colas de
expiración/recordatorio/no-show) ya funcionan en producción simulada, con un patrón de consumer
group + `XAUTOCLAIM` + dead-letter que fue **corregido en vivo tras encontrar un bug real** (ver
`SPEC.md`, 2026-06-21: el reintento nunca funcionaba antes del fix). Reemplazar esto por SQS no es
gratis: se perdería ese trabajo ya validado, a cambio de un servicio gestionado con menos
mantenimiento operativo propio.

## Opciones consideradas

1. **Migrar todo a SQS** (colas) + SNS o EventBridge (pub/sub de eventos de dominio).
   - Pros: sin servidor Redis que operar/parchar/monitorear; escalado y durabilidad gestionados
     por AWS; integra nativamente con Lambda (relevante si ADR-007 usa Lambda para jobs).
   - Contras: reescribir `event-consumer.ts`, `outbox-relay.ts`, y las 3 colas de BullMQ en los 5
     servicios — descarta trabajo ya probado en producción simulada (incluyendo el fix real del
     bug de reintentos); SQS no tiene un análogo directo a "consumer group leyendo el mismo stream
     desde distintos offsets" (múltiples colas por consumidor sería la alternativa, con sus propios
     trade-offs de duplicación de mensajes).
2. **Mantener Redis Streams + BullMQ tal cual, correr Redis como ElastiCache gestionado**.
   - Pros: cero reescritura de lógica de dominio; ElastiCache quita la carga operativa de parchar/
     escalar Redis manualmente; el patrón ya validado (incluyendo el fix de `XAUTOCLAIM`) se
     conserva íntegro.
   - Contras: ElastiCache no es tan "serverless" como SQS (sigue siendo una instancia con la que
     dimensionar memoria); Redis Streams tiene menos garantías de durabilidad multi-AZ nativas que
     SQS sin configuración adicional (persistencia AOF/RDB, replicación).
3. **Coexistencia**: mantener Redis Streams/BullMQ para el dominio actual, e introducir SQS solo
   para los flujos nuevos de la Fase 8 (aprovisionamiento de tenant) y de la Fase 5 (jobs de
   retención) que no tienen ya un patrón implementado.
   - Pros: no se toca lo que ya funciona y está probado; SQS se usa donde no hay deuda que
     preservar, aprovechando su integración nativa con Lambda si ADR-007 lo requiere.
   - Contras: dos tecnologías de mensajería operando en paralelo — más superficie de
     observabilidad (Fase 6) y de runbooks (Fase 7) que mantener.

## Decisión

**PENDIENTE DE DECISIÓN HUMANA.**

## Consecuencias

- **Positivas:** *(pendiente)*
- **Negativas / tradeoffs:** cualquier opción que mantenga Redis Streams hereda también su deuda
  ya conocida: el gap del Outbox de Auth sin relay (`docs/backlog-deuda.md`, ítem 6) y la falta de
  namespace de tenant en las claves (ítem 3) — ninguna de las tres opciones resuelve esto por sí
  sola, sigue siendo trabajo de la Fase 3.
- **Cosas a monitorear:** si se elige la Opción 1 o 3 con SQS nuevo, vigilar el orden de entrega
  (SQS estándar no garantiza orden; SQS FIFO sí pero con throughput menor) — relevante para eventos
  como `AppointmentStatusChanged` donde el orden de transiciones importa.

## Referencias
- `SPEC.md`, changelog Fase 3 (bug real de `event-consumer.ts` y su fix)
- `docs/backlog-deuda.md`, ítems 3, 6, 11
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, ADR-010 en la tabla de la sección 1.5
