# C4 Nivel 2 — Diagrama de Contenedores

Referencia: [RFC-001-bounded-contexts.md](../../RFC-001-bounded-contexts.md),
[ADR-001-sync-vs-async.md](../../ADR-001-sync-vs-async.md),
[ADR-002-transacciones-distribuidas.md](../../ADR-002-transacciones-distribuidas.md).

Cada flecha está etiquetada explícitamente como **HTTP** (síncrono) o **evento** (asíncrono, vía
Redis Streams). Esta etiqueta no es decorativa: es la regla de ADR-001 aplicada visualmente.

```mermaid
C4Container
    title Clínica Scheduler — Contenedores (post strangler fig)

    Person(patient, "Paciente", "Reserva citas, paga, sin login")
    Person(admin, "Admin/Staff", "Gestiona citas, doctores, usuarios")

    System_Boundary(clinica, "Clínica Scheduler") {
        Container(gateway, "Gateway", "Fastify", "Reverse proxy, valida JWT, enruta por /v1/<servicio>")

        Container(auth, "Auth Service", "Node.js + Postgres propio", "Login Admin/Staff, JWT, JWKS")
        Container(appointments, "Appointments Service", "Node.js + Postgres propio", "State machine de citas + Patients (sub-dominio) + tabla Outbox")
        Container(doctors, "Doctors Service", "Node.js + Postgres propio", "Perfil de doctor, disponibilidad, slots")
        Container(payments, "Payments Service", "Node.js + Postgres propio", "Integración Stripe, PaymentIntents, refunds, webhook receiver")
        Container(notifications, "Notifications Service", "Node.js + Postgres propio (read-model)", "Consumer de eventos, envío de email/SMS, read-model propio")

        ContainerDb(redis, "Redis Streams", "Redis", "Broker de eventos de dominio (at-least-once)")
    }

    System_Ext(stripe, "Stripe", "Procesador de pagos externo")
    System_Ext(resend, "Resend", "Proveedor de email externo")

    Rel(patient, gateway, "Reserva cita, paga", "HTTP")
    Rel(admin, gateway, "Login, gestiona citas/doctores", "HTTP")

    Rel(gateway, auth, "Login / verificar JWT", "HTTP")
    Rel(gateway, appointments, "CRUD citas/pacientes", "HTTP")
    Rel(gateway, doctors, "CRUD doctores/slots", "HTTP")
    Rel(gateway, payments, "Refunds (admin)", "HTTP")
    Rel(gateway, notifications, "Dead-letter / health (admin)", "HTTP")

    Rel(appointments, auth, "Verificar JWT (JWKS, cacheado)", "HTTP")
    Rel(doctors, auth, "Verificar JWT (JWKS, cacheado)", "HTTP")
    Rel(payments, auth, "Verificar JWT (JWKS, cacheado)", "HTTP")

    Rel(appointments, doctors, "¿Qué slots están libres?", "HTTP")
    Rel(appointments, payments, "Crear PaymentIntent / Refund", "HTTP")
    Rel(payments, stripe, "PaymentIntents, refunds, webhooks", "HTTP")
    Rel(notifications, resend, "Enviar email", "HTTP")

    Rel(auth, redis, "Publica UserCreated, UserDeactivated", "evento")
    Rel(appointments, redis, "Publica AppointmentCreated, AppointmentStatusChanged, PatientUpdated (vía Outbox)", "evento")
    Rel(doctors, redis, "Publica DoctorCreated, DoctorUpdated", "evento")
    Rel(payments, redis, "Publica PaymentSucceeded, PaymentFailed, RefundIssued (vía Outbox)", "evento")

    Rel(redis, appointments, "Consume PaymentSucceeded, PaymentFailed, RefundIssued", "evento")
    Rel(redis, notifications, "Consume AppointmentCreated, AppointmentStatusChanged, PatientUpdated, DoctorCreated/Updated", "evento")
```

## Lectura del diagrama

- **Toda flecha HTTP es una dependencia dura**: si ese contenedor cae, la operación falla. Esto es
  aceptado para Doctors y Payments en el flujo de creación de cita (ver ADR-001) — no para
  Notifications.
- **Ninguna flecha HTTP llega a Notifications desde Appointments.** Esa es la verificación visual
  de la regla #4 del plan: la reserva de citas no depende síncronamente de Notifications. Solo
  hay flechas de evento hacia Notifications.
- **Auth nunca es consultado por BD** por otro servicio — solo expone JWKS vía HTTP, que los demás
  cachean localmente (ver RFC-001 decisión 2). Ningún servicio hace `SELECT` contra la base de
  Auth.
- **Redis Streams es el único canal de eventos**; no hay colas punto a punto entre servicios.
