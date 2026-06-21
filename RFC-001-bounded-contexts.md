# RFC-001 — Bounded Contexts para la descomposición del monolito

**Estado:** Aprobado — ver "Decisiones aprobadas" abajo
**Autor del borrador:** Claude Code (bajo instrucción explícita de no decidir, solo presentar opciones)
**Decisor:** Ricardo (humano)
**Aprobado:** 2026-06-20

## Propósito de este documento

Este RFC **no contiene decisiones**. Contiene preguntas que hay que responder antes de escribir
el primer contrato OpenAPI o la primera línea de código de servicios, junto con 2 opciones por
pregunta y sus trade-offs. Según `PLAN.md` (Fase 0, regla #1), Claude Code no decide los bounded
contexts — esto se aprueba explícitamente antes de avanzar a la Fase 1.

## Contexto relevante extraído del monolito actual (`SPEC.md`, `src/`)

Para que las opciones de abajo sean concretas y no abstractas, este es el estado real hoy:

- **No existe una entidad `User`/principal de autenticación.** `Patient` y `Doctor` son entidades
  de dominio (datos de contacto, no credenciales). El único mecanismo de auth hoy es
  `requireAdminAuth` (`src/middleware/admin-auth.ts`), que compara un header `x-admin-key` contra
  `env.ADMIN_API_KEY` — no hay login, no hay JWT, no hay tabla de usuarios.
- `Appointment` vive en una sola tabla Postgres con FK directas a `Patient.id` y `Doctor.id`
  (`src/prisma/schema.prisma`). El state machine (`appointments/state-machine.ts`) y los
  `AppointmentEvent` son el corazón del dominio.
- `Notifications` hoy es una llamada directa desde dentro del mismo proceso (`email.service.ts`
  + BullMQ `email.worker.ts`), no un servicio separado ni un consumer de eventos.
- `Payments` (Stripe) está acoplado al módulo de `appointments` vía `payments.service.ts` y
  `webhooks.handler.ts`, pero conceptualmente es su propia preocupación.

Esto importa porque la pregunta 1 (fuente de verdad de "usuario") no tiene una respuesta trivial:
hoy no hay "usuario" en el sentido de Auth, solo Pacientes, Doctores y un admin compartido.

---

## Pregunta 1 — ¿Qué es "Auth" en este sistema y quién es la fuente de verdad de un principal autenticado?

Hoy no hay usuarios reales, solo un API key de admin. Para que Auth sea un bounded context real,
hay que decidir su alcance.

**Opción A — Auth gestiona solo identidades operativas (Admin/Staff), Pacientes y Doctores quedan como datos de dominio sin login propio (por ahora).**
- Alcance mínimo: Auth emite JWT para admins/staff. Patients y Doctors siguen siendo registros
  gestionados por Appointments (o por un futuro servicio propio), sin autenticación de su parte.
- Trade-offs: scope chico, fácil de extraer ya. Pero no resuelve "el paciente inicia sesión para
  ver sus citas" si eso es un requisito real; quedaría como deuda explícita para una fase futura.

**Opción B — Auth gestiona todos los principales (Admin, Doctor, Patient) desde el día 1, con roles.**
- Alcance amplio: tabla `User` en Auth con `role` (`ADMIN`, `DOCTOR`, `PATIENT`), y `Patient`/`Doctor`
  en Appointments/Doctors pasan a ser perfiles de dominio enlazados por `userId` (vía evento
  `UserCreated`, no por FK directa entre BDs).
- Trade-offs: más trabajo de migración ahora (hay que decidir qué pasa con los `Patient`/`Doctor`
  existentes sin `userId`), pero evita un segundo refactor de Auth más adelante si el negocio
  termina necesitando login de pacientes/doctores.

**Necesito de ti:** ¿el roadmap real incluye que pacientes o doctores inicien sesión (portal propio),
o Auth es exclusivamente para proteger el panel admin que ya existe?

---

## Pregunta 2 — ¿Cómo valida Appointments la identidad de quien hace una request: JWT stateless o read-model local poblado por eventos?

Mencionada explícitamente en `PLAN.md` como pregunta obligatoria de la Fase 0.

**Opción A — JWT stateless con llave pública de Auth (sin tocar su BD).**
- Appointments verifica la firma del JWT localmente (JWKS o llave pública distribuida), extrae
  `userId`/`role`/claims, y no necesita persistir nada de Auth.
- Trade-offs: cero estado compartido, cero latencia adicional, simple de razonar. Pero si Auth
  necesita revocar un token antes de su expiración (ej. admin desactivado), Appointments seguirá
  aceptándolo hasta que expire — requiere TTLs cortos + refresh, o una lista de revocación que
  reintroduce un punto de consulta compartido.

**Opción B — Read-model local en Appointments, poblado por eventos (`UserCreated`, `UserDeactivated`).**
- Appointments mantiene su propia tabla mínima (`id`, `role`, `active`) actualizada por consumo
  de eventos de Auth. La validación de JWT solo confirma la firma; el estado "¿sigue activo?" se
  consulta localmente.
- Trade-offs: revocación inmediata funciona bien. Pero introduce un nuevo tipo de estado
  eventualmente consistente dentro de Appointments (latencia entre `UserDeactivated` y que el
  read-model se actualice), y más superficie de código (consumer, migration, reconciliación).

**Necesito de ti:** ¿la revocación inmediata de acceso es un requisito real (ej. compliance,
seguridad), o expiración corta de JWT (ej. 15min) es aceptable?

---

## Pregunta 3 — ¿Dónde está la frontera transaccional de "crear una cita"?

Hoy, crear una cita y crear el `PaymentIntent` en Stripe ocurre en la misma request síncrona
(ver `SPEC.md` sección 3, diagrama de secuencia). Al separar servicios, hay que decidir si
Payments es su propio bounded context o vive dentro de Appointments.

**Opción A — Payments vive dentro de Appointments (no es un servicio separado en esta fase).**
- `stripe.paymentIntents.create()` sigue siendo una llamada síncrona desde Appointments, en la
  misma transacción lógica que crear el registro `PENDING → CONFIRMED`.
- Trade-offs: no introduce un servicio nuevo que coordinar (menos superficie para esta entrega),
  pero dificulta versionar/escalar Payments de forma independiente si crece (ej. soportar otros
  proveedores de pago a futuro).

**Opción B — Payments es su propio servicio desde ahora, Appointments lo llama vía HTTP síncrono.**
- Appointments hace `POST /v1/payment-intents` a Payments; Payments es dueño de la integración
  Stripe y del webhook `/api/webhooks/stripe`.
- Trade-offs: respeta mejor el principio de "single responsibility" por servicio y aísla el
  riesgo de cambios de Stripe SDK, pero agrega un servicio más al scope de la Fase 1-2 (Docker,
  CI, contrato OpenAPI) cuando el plan ya define el mínimo como Auth/Appointments/Notifications.

**Necesito de ti:** ¿Payments cuenta como el 4to servicio (ok extender el scope de "≥3 servicios"),
o preferís mantenerlo dentro de Appointments en esta ronda y evaluarlo como servicio separado en
una fase posterior?

---

## Pregunta 4 — ¿Quién es la fuente de verdad de "cita" en el read-model de Notifications?

Notifications necesita saber a quién notificar y con qué datos (email del paciente, nombre del
doctor, fecha) sin consultar la BD de Appointments directamente (regla #3 del plan).

**Opción A — El evento `AppointmentCreated`/`AppointmentStatusChanged` lleva todos los datos necesarios embebidos (patrón "evento gordo").**
- El payload del evento incluye `patientEmail`, `patientName`, `doctorName`, `dateTime`, etc.,
  copiados al momento de publicar. Notifications no necesita persistir nada more allá del log de
  envíos.
- Trade-offs: simple, sin segunda tabla que mantener en Notifications. Pero si el dato cambia
  después (ej. el paciente actualiza su email) y la cita aún no se notificó, el evento ya tiene
  el dato viejo — hay que decidir si esto es aceptable o si se necesita un evento de corrección.

**Opción B — Notifications mantiene su propio read-model mínimo (`AppointmentSnapshot`) poblado por eventos, y el evento de dominio solo lleva IDs.**
- El evento lleva `appointmentId`, `patientId`, `doctorId`. Notifications consulta su propio
  read-model (poblado por `PatientUpdated`/`DoctorUpdated`/`AppointmentCreated`) para armar el
  email.
- Trade-offs: datos siempre consistentes con la última versión conocida vía eventos, pero exige
  que Patients/Doctors también publiquen sus propios eventos de cambio — más servicios emitiendo
  eventos, más esquemas que versionar.

**Necesito de ti:** ¿con qué frecuencia cambian email/nombre de un paciente entre que se crea la
cita y se envía la notificación? Si es raro, Opción A es proporcional al problema.

---

## Pregunta 5 — ¿"Doctors" es su propio bounded context o vive dentro de Appointments?

El plan menciona solo 3 servicios mínimos (Auth, Appointments, Notifications), pero hoy
`doctors` es un módulo separado con su propia lógica de disponibilidad/slots
(`doctors/slots.ts`).

**Opción A — Doctors vive dentro de Appointments (mismo servicio, mismo Postgres) en esta entrega.**
- Slots, disponibilidad y datos de doctor se mantienen junto a Appointments. Se documenta como
  candidato a extracción futura.
- Trade-offs: cumple el mínimo de "≥3 servicios" sin sumar superficie. El acoplamiento interno
  entre "disponibilidad" y "reserva" es real hoy (mismo proceso de cálculo de slots libres), así
  que mantenerlos juntos reduce el riesgo de over-engineering para esta ronda.

**Opción B — Doctors es un 4to servicio desde ahora, con su propia BD; Appointments lo consulta vía HTTP para slots disponibles.**
- Trade-offs: separa mejor el dominio "agenda médica" de "gestión de citas", pero introduce
  acoplamiento síncrono en el camino crítico de reserva (Appointments necesitaría preguntarle a
  Doctors qué slots están libres en tiempo real, o mantener su propio read-model de
  disponibilidad).

**Necesito de ti:** ¿Doctors necesita escalar o desplegarse independientemente en el corto plazo,
o es razonable dejarlo dentro de Appointments por ahora?

---

## Decisiones aprobadas

| # | Pregunta | Decisión | Opción elegida |
|---|---|---|---|
| 1 | Alcance de Auth | Auth cubre únicamente usuarios que se loguean en el panel admin/staff. Los pacientes **no** tienen login ni cuenta — solo pueden reservar una cita como flujo público sin autenticación. Doctores tampoco se loguean (su información se gestiona desde el panel admin/staff o desde su propio servicio, sin sesión propia). | A (alcance acotado a Admin/Staff) |
| 2 | Validación de identidad en Appointments | JWT stateless, verificado con la llave pública de Auth (JWKS). Appointments no persiste ni consulta estado de usuarios. Implica TTL corto + refresh para mitigar el caso de revocación (admin desactivado); se documenta como trade-off aceptado, no como pendiente abierto. | A (JWT stateless) |
| 3 | Frontera de Payments | Payments es un servicio independiente desde esta fase. Posee la integración con Stripe y el endpoint `/api/webhooks/stripe`. Appointments crea el cobro llamando a Payments vía HTTP síncrono; el resultado del webhook (`payment_intent.succeeded`/`failed`) se propaga a Appointments como **evento asíncrono** (no como respuesta síncrona), preservando la regla de que Appointments nunca depende síncronamente de un servicio externo para confirmar su propio estado. | B (servicio separado) |
| 4 | Read-model de Notifications | Notifications mantiene su propio read-model (`AppointmentSnapshot`, `PatientSnapshot`, `DoctorSnapshot`) poblado por eventos. Los eventos de dominio (`AppointmentCreated`, `AppointmentStatusChanged`, `PatientUpdated`, `DoctorUpdated`) llevan solo IDs + los campos mínimos necesarios para reconstruir el snapshot, no el dato completo "congelado". | B (read-model propio) |
| 5 | Bounded context de Doctors | Doctors es un servicio separado, con su propia BD (datos de doctor, especialidad, disponibilidad, slots). Appointments lo consulta vía HTTP síncrono para verificar/calcular slots disponibles al momento de reservar — es una **query**, no un side effect, por lo que es síncrono según ADR-001. | B (servicio separado) |

### Aclaración a la decisión 1 (2026-06-20): el paciente sí puede cancelar su cita

La decisión 1 dice que el paciente "solo puede reservar una cita" — Ricardo confirmó que esto
**no excluye la cancelación**: el paciente sí puede cancelar su propia cita, sin tener cuenta.
Esto replica el comportamiento que ya tiene el monolito hoy
(`src/modules/appointments/appointments.routes.ts`): `cancel` no está detrás de
`requireAdminAuth`, a diferencia de `complete`/`no-show`.

Mecanismo: el paciente se identifica por **posesión del UUID de la cita** (ej. el link del email
de confirmación), no por sesión — es un patrón de capability token, no de autenticación. Esto ya
se refleja en `gateway/src/middleware/verify-jwt.ts` (rutas públicas) y en
`packages/contracts/appointments/openapi.yaml` (`getAppointment` y `cancelAppointment` sin
`security: bearerAuth`). `listAppointments` (listar **todas** las citas) sigue siendo exclusivo
de Admin/Staff — ahí sí se necesita JWT, porque no hay un único UUID que acote el acceso.

### Consecuencia: inventario final de servicios (Fase 1 en adelante)

Con estas decisiones, el sistema queda en **5 servicios** (supera el mínimo de 3 que pide el plan):

1. **Auth** — usuarios Admin/Staff, login, emisión/verificación de JWT.
2. **Appointments** — state machine de citas, **incluye Patients** como sub-dominio (no se extrae
   como servicio propio: los pacientes no tienen identidad de auth ni ciclo de vida independiente
   de la cita, así que separarlos hoy sería extracción prematura). Posee la tabla Outbox.
3. **Doctors** — perfil de doctor, disponibilidad, cálculo de slots.
4. **Payments** — integración Stripe, PaymentIntents, refunds, webhook receiver.
5. **Notifications** — envío de email (y luego SMS), consumer de eventos, read-model propio.

Nota: `Patients` queda explícitamente como **candidato a extracción futura**, no como decisión
cerrada para siempre — se revisita si el negocio agrega login de pacientes.

**Ampliación de scope confirmada (2026-06-20):** el plan original (`PLAN.md`, sección 1) pedía un
mínimo de 3 servicios (Auth, Appointments, Notifications). Las decisiones 3 y 5 de este RFC
amplían el scope a 5 servicios (se suman Doctors y Payments como servicios independientes).
Ricardo confirmó explícitamente esta ampliación — no es un default asumido por Claude Code.
Esto incrementa el trabajo de Fase 1 (Docker Compose, `paths` filters de CI, contratos) en 2
servicios adicionales respecto al mínimo original.

### Eventos de dominio identificados (a formalizar en los esquemas OpenAPI/AsyncAPI)

- `UserCreated`, `UserDeactivated` — publicados por Auth.
- `AppointmentCreated`, `AppointmentStatusChanged` — publicados por Appointments (incluye
  transiciones disparadas por pago, cancelación, no-show, etc.). `PatientUpdated` también sale de
  Appointments al ser dueño del sub-dominio Patients.
- `DoctorUpdated`, `DoctorCreated` — publicados por Doctors.
- `PaymentSucceeded`, `PaymentFailed`, `RefundIssued` — publicados por Payments; Appointments los
  consume para avanzar la state machine (`CONFIRMED → PAID`, etc.) de forma asíncrona e idempotente.

## Qué sigue

Con el RFC aprobado, se redacta (resto de la Fase 0):

1. Los 5 contratos OpenAPI 3.1 en `packages/contracts/` (Auth, Appointments, Doctors, Payments,
   Notifications) reflejando las decisiones de arriba.
2. Los 3 ADRs (`ADR-001-sync-vs-async.md`, `ADR-002-transacciones-distribuidas.md`,
   `ADR-003-versionado-apis.md`).
3. El diagrama C4 nivel 2 en Mermaid, con cada flecha etiquetada HTTP o evento según lo decidido
   aquí.
4. La actualización de `SPEC.md` con la sección "Arquitectura de servicios" y el changelog.

Todavía **no se escribe código de servicios** (eso es Fase 1+) — esta fase es solo diseño.
