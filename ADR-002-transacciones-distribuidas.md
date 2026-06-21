# ADR-002 — Sin 2PC: consistencia eventual + patrón Outbox

**Estado:** Aceptado
**Fecha:** 2026-06-20
**Contexto del RFC:** [RFC-001-bounded-contexts.md](./RFC-001-bounded-contexts.md) — decisión 3 y 4

## Contexto

En el monolito (`SPEC.md` sección 3), crear una cita, registrar el `AppointmentEvent` y encolar
los jobs de BullMQ ocurría dentro de procesos del mismo runtime, con una sola base de datos.
Al separar Appointments, Doctors, Payments y Notifications en servicios con BD propia (regla #3
del plan: cero estado compartido), una operación de negocio como "crear una cita y notificar"
ahora cruza varios servicios. Hay que decidir cómo se mantiene la consistencia sin transacciones
distribuidas clásicas (2PC), que el plan descarta explícitamente.

## Decisión

**No se usa 2PC.** Se adopta **consistencia eventual** entre servicios, implementada con el
**patrón Outbox** para la publicación confiable de eventos. **Saga** se reserva únicamente para
flujos multi-paso reversibles (ver más abajo); hoy no hay ninguno que lo requiera.

### Patrón Outbox (Appointments y Payments)

Cada servicio que necesita publicar un evento como consecuencia de un cambio de estado en su
propia BD:

1. Escribe la fila de negocio (ej. `Appointment.status = CONFIRMED`) **y** una fila en su propia
   tabla `OutboxEvent` **en la misma transacción de Postgres**.
2. Un proceso `relay` (poll del Outbox o `LISTEN/NOTIFY` de Postgres) lee filas no publicadas y
   las empuja a Redis Streams.
3. Tras publicar exitosamente, marca la fila como `publishedAt = now()`.

Esto garantiza que **nunca** existe un estado donde la cita cambió pero el evento se perdió (o
viceversa): ambos viven en la misma transacción ACID local. El relay puede fallar y reintentar
sin duplicar el efecto de negocio, porque lo único que hace es publicar — la idempotencia del
lado consumidor (ver `tests/unit/idempotency.test.ts` como precedente del monolito) absorbe los
reintentos.

```
BEGIN;
  UPDATE appointments SET status = 'CONFIRMED' WHERE id = $1;
  INSERT INTO outbox_events (type, payload) VALUES ('AppointmentStatusChanged', $2);
COMMIT;
-- el relay, en otro proceso, lee outbox_events y publica a Redis Streams
```

### Saga — solo si aparece un flujo multi-paso reversible

Ninguno de los flujos actuales (crear cita, confirmar pago, notificar, cancelar con refund)
requiere coordinar múltiples escrituras irreversibles entre servicios con necesidad de
compensación explícita: cada paso ya tiene su propia compensación natural dentro del mismo
servicio (ej. cancelar = transición de estado + refund, ambos dentro de Payments/Appointments
via eventos, no una cadena de pasos que necesite "deshacerse"). Si una fase futura introduce un
flujo donde un paso 3 puede fallar y haya que revertir los pasos 1 y 2 en *otros* servicios, ahí
se evalúa Saga (orquestada o coreografiada) en un ADR nuevo — no se diseña especulativamente
ahora.

## Opciones consideradas

**Opción A (elegida) — Outbox + consistencia eventual, sin Saga por defecto.**
- Trade-offs: exige una tabla extra y un proceso relay por servicio publicador, pero es el patrón
  estándar para "escribir en mi BD + publicar un evento" sin perder atomicidad, y es la base que
  permite el degraded mode (regla central del plan): si Notifications está caído, el evento queda
  en el stream esperando, no se pierde.

**Opción B (descartada) — 2PC entre Postgres de cada servicio.**
- Se descarta explícitamente por el plan. Además, 2PC no resolvería el caso de Notifications
  caído sin bloquear la transacción de Appointments — viola la regla #4 (la reserva no depende
  síncronamente de Notifications).

## Consecuencias

- Appointments y Payments necesitan tabla `OutboxEvent` + proceso `relay` desde la Fase 2/3 del
  plan (extracción de Appointments, luego "Implementar el relay del Outbox" en Fase 3).
- Todo evento puede llegar duplicado al consumidor (Redis Streams = at-least-once). Cada consumer
  (Notifications, Appointments consumiendo `PaymentSucceeded`) debe ser idempotente — mismo
  patrón que ya existe en el monolito para webhooks de Stripe (`WebhookEvent` con `stripeEventId`
  único), ahora aplicado a `eventId` de cada evento de dominio.
- Hay una ventana de inconsistencia entre "se confirmó el pago en Payments" y "Appointments lo
  refleja en su propio estado" — aceptado como trade-off de consistencia eventual. El admin no
  debería ver esto como un bug si el lag es de segundos, no minutos; si el lag del consumer crece,
  es una señal de alerta (ver `POSTMORTEM-notifications-peak.md` en Fase 5).
