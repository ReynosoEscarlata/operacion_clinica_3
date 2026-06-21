# ADR-001 — HTTP síncrono para queries, eventos asíncronos para efectos secundarios

**Estado:** Aceptado
**Fecha:** 2026-06-20
**Contexto del RFC:** [RFC-001-bounded-contexts.md](./RFC-001-bounded-contexts.md) — decisiones 2, 3 y 5

## Contexto

Al partir el monolito en 5 servicios (Auth, Appointments, Doctors, Payments, Notifications),
cada interacción entre servicios tiene que decidirse explícitamente como **HTTP síncrono** o
**evento asíncrono**. El plan (`PLAN.md`, regla #4) exige que la reserva de citas nunca dependa
síncronamente de Notifications, y la regla #3 prohíbe que un servicio consulte la BD de otro.
Sin un criterio único, cada PR reinterpretaría esto caso por caso.

## Decisión

**Criterio:** si la operación es una **query** (necesito un dato ahora para responder esta
request) → HTTP síncrono. Si la operación es un **efecto secundario** (algo que debe pasar como
consecuencia de un hecho de dominio, pero que no bloquea la respuesta al usuario) → evento
asíncrono publicado en Redis Streams.

Una forma simple de aplicarlo: **¿el usuario necesita ver el resultado de esto en la respuesta
HTTP de su request?** Si sí → síncrono. Si no (es trabajo de fondo) → evento.

### Mapeo concreto

| Interacción | Tipo | Justificación |
|---|---|---|
| Appointments → Doctors: ¿qué slots están libres? | HTTP síncrono | Es una query: el paciente necesita ver los slots disponibles en la misma respuesta. |
| Appointments → Payments: crear PaymentIntent | HTTP síncrono | El paciente necesita el `clientSecret` en la respuesta de `POST /appointments` para poder pagar. |
| Gateway → Auth: verificar JWT | HTTP síncrono (o verificación local con JWKS, ver Decisión 2 del RFC) | Bloquea la request actual; sin esto no se puede autorizar nada. |
| Payments → Appointments: "el pago se confirmó/falló" | **Evento asíncrono** (`PaymentSucceeded`/`PaymentFailed`) | Es un hecho que ocurre fuera del ciclo de vida de la request original (llega por webhook de Stripe, minutos/horas después). Appointments lo consume y transiciona su state machine. |
| Appointments → Notifications: "hay que avisarle al paciente" | **Evento asíncrono** (`AppointmentCreated`, `AppointmentStatusChanged`) | Es la regla central del plan: la reserva de citas nunca espera a que Notifications responda. Si Notifications está caído, la cita se crea igual. |
| Appointments/Doctors → Notifications: mantener el read-model | **Evento asíncrono** (`PatientUpdated`, `DoctorUpdated`, etc.) | Notifications no consulta la BD de otros servicios (regla #3); se suscribe a eventos para mantener su propio snapshot. |

### Regla derivada

Ningún servicio hace `await fetch(<otro-servicio>)` dentro del flujo crítico de escritura de su
propio dominio si esa llamada **no es necesaria para responder la request actual**. Esto es lo
que el plan llama "acoplamiento síncrono escondido" en la sección de riesgos — se vigila en code
review.

## Opciones consideradas

**Opción A (elegida) — Criterio query=síncrono / efecto secundario=asíncrono.**
- Trade-offs: requiere disciplina en code review (es fácil "colar" un fetch síncrono porque "funciona
  más simple"), pero da un criterio objetivo y fácil de explicar a un revisor humano, alineado con
  el requisito de degraded mode.

**Opción B (descartada) — Todo asíncrono salvo autenticación.**
- Habría forzado que incluso la consulta de slots de Doctors pasara por un read-model local en
  Appointments poblado por eventos.
- Se descarta porque introduce complejidad de eventual consistency en una query de lectura simple
  que hoy es trivial de resolver con una llamada HTTP directa, sin beneficio claro de degraded
  mode (si Doctors está caído, no tiene sentido mostrar slots desactualizados como si estuvieran
  disponibles para reservar).

## Consecuencias

- Appointments queda con una dependencia síncrona dura de Doctors (para slots) y de Payments
  (para el PaymentIntent). Si Doctors o Payments caen, la creación de citas falla — esto es
  aceptado explícitamente, a diferencia de Notifications.
- La confirmación de pago (`PaymentSucceeded`) y el aviso al paciente (`AppointmentStatusChanged`
  → Notifications) son asíncronos, lo que implica diseñar Appointments con el patrón Outbox desde
  el principio (ver [ADR-002](./ADR-002-transacciones-distribuidas.md)) para no perder eventos.
- Todo handler de evento debe ser idempotente (mismo evento dos veces ≠ doble efecto), ya que
  Redis Streams con consumer groups no garantiza "exactly once", solo "at least once".
