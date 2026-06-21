# RFC-002 — Dónde vive el dashboard/lista de citas/dead-letter del panel admin

**Estado:** Aprobado
**Autor del borrador:** Claude Code (bajo instrucción explícita de no decidir, solo presentar opciones)
**Decisor:** Ricardo (humano)
**Aprobado:** 2026-06-21

## Contexto

El panel admin (`admin/`) se conectó al gateway de la migración (login real vía Auth, flujo
público de reserva vía Appointments/Doctors/Payments — ver `SPEC.md` changelog 2026-06-21). Quedó
pendiente el dashboard, la lista de citas con acciones y la gestión de dead-letter: en el monolito
vivían bajo `/api/admin/*`, sin equivalente en ningún microservicio nuevo. RFC-001 nunca contempló
un agregador de stats/eventos/dead-letter — no era parte del alcance original de los 5 bounded
contexts.

## Opciones presentadas

1. **Appointments expone su propia API admin.** Dashboard/eventos/dead-letter de Appointments
   viven en Appointments (ya es dueño de `Appointment`/`AppointmentEvent`/`DeadLetterEntry`);
   Notifications expone su propio dead-letter por separado. El panel pega a cada uno directo, sin
   agregador nuevo.
   - Pros: cero bounded context nuevo, cada servicio sigue siendo dueño exclusivo de sus datos
     (consistente con ADR-002/zero estado compartido), mínimo cambio de infra.
   - Cons: el panel conoce 2 superficies de dead-letter en vez de una vista unificada; si en el
     futuro se agrega dead-letter a otro servicio, el panel necesita otro cambio.
2. **Nuevo servicio Admin-BFF.** Un 6to servicio agrega todo llamando a los demás por HTTP.
   - Pros: el panel habla con un solo backend, vista unificada real.
   - Cons: bounded context nuevo no contemplado en RFC-001, infra completa (Dockerfile, CI, Prisma
     si necesitara persistencia propia), más superficie para mantener.
3. **El gateway agrega.** El gateway (ya existe) expone `/v1/admin/*` y hace fan-out a
   Appointments + Notifications.
   - Pros: no agrega infra nueva.
   - Cons: el gateway deja de ser un proxy + verificador de JWT y empieza a tener lógica de
     negocio/agregación — mezcla responsabilidades que `RFC-001`/`ADR-001` mantuvieron separadas
     deliberadamente.

## Decisión

**Opción 1.** Appointments expone su propia API admin (`/v1/admin/dashboard`, `/v1/admin/events`,
`/v1/admin/dead-letter` + retry/delete); Notifications expone su propio `/v1/dead-letter` (mismo
patrón, sin acoplarlos). El panel admin habla con ambos directamente — no hay agregador.

**Justificación:** mantiene la regla de cero estado compartido y "cada servicio dueño de sus
datos" sin introducir un sexto bounded context ni mover lógica de negocio al gateway. El costo
(el panel conoce 2 superficies de dead-letter) es aceptable para el tamaño actual del sistema (2
servicios con dead-letter); si crece, se puede reabrir esta RFC.

## Detalle de implementación (a registrarse en `SPEC.md` al completarse)

- `noShowRateByDoctor` del dashboard **no incluye el nombre del doctor** desde Appointments — solo
  `doctorId`. Appointments no tiene ni debe tener acceso a los datos de Doctors (RFC-001 decisión
  5, zero estado compartido); resolver el nombre es responsabilidad del cliente (el panel ya
  obtiene la lista de doctores para el filtro, ahí resuelve `doctorId → name`).
- Endpoints de lista/detalle/cancelar/completar/no-show **ya existen** en Appointments
  (`/v1/appointments`, `/v1/appointments/:id`, etc., agregados en la Fase 2) — falta adaptar el
  shape de respuesta a lo que espera el panel y agregar paginación por cursor donde falte.
