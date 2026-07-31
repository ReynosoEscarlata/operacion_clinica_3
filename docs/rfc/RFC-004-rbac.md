# RFC-004: Modelo de autorización (RBAC + ABAC)

**Fase:** 1 del `claude/PLAN-challenge-5-plataforma-para-todos.md`
**Estado:** Aceptado (2026-07-29)
**Relacionado:** `docs/baseline-challenge-4.md`, RFC-003-tenancy.md, ADR-012.

## Contexto

Hoy el sistema tiene un único plano de autorización, binario y plano: `services/auth` define
`UserRole = ADMIN | STAFF` (ver `schema.prisma`), y el gateway (`verify-jwt.ts`) solo distingue
"ruta pública" (paciente, sin cuenta, identificado por posesión del UUID de su cita) de "ruta
protegida" (requiere JWT válido, sin diferenciar `ADMIN` de `STAFF` en la mayoría de los
endpoints). No existe hoy el concepto de "clínica" en ningún rol — cualquier `ADMIN`/`STAFF`
autenticado puede, en principio, operar sobre cualquier cita del sistema, porque el sistema mismo
es de una sola clínica.

Convertir esto en SaaS B2B requiere dos cosas que hoy no existen: (1) un segundo plano de
autorización —el de la plataforma, no el del tenant— para el equipo que opera el SaaS, y (2) roles
con distinto alcance dentro de una misma clínica (`clinic_owner` no es lo mismo que
`receptionist`), donde hoy solo hay `ADMIN`/`STAFF`.

## Los dos planos de autorización

- **Plano de plataforma:** `platform_admin`, `platform_support`. Acceso cross-tenant, con
  auditoría reforzada y justificación obligatoria. No existen hoy ni siquiera como concepto — hoy
  "ser ADMIN" ya implica ver todo, porque todo es una sola clínica.
- **Plano de tenant:** `clinic_owner`, `clinic_admin`, `doctor`, `receptionist`, `patient`. Todos
  acotados a los datos de su propia clínica (RFC-003).

Es el error más común en SaaS B2B mezclar ambos planos en un solo rol — un `platform_support` que
"también es admin de todas las clínicas" porque el modelo no distingue los dos contextos.

## Modelo elegido: RBAC + ABAC para reglas de propiedad del recurso

RBAC puro (rol → permisos fijos) alcanza para la mayoría de las reglas, pero **no alcanza para el
caso del médico**: un `doctor` puede leer citas (`appointment:read`), pero solo **las suyas**, no
las de otro doctor de la misma clínica. Esa restricción no es function del rol (`doctor`) sino de
la relación entre el actor y el recurso concreto (`appointment.doctorId === actor.id`) — eso es
ABAC (atributo del recurso), no RBAC. Por eso el modelo es **RBAC para la puerta de entrada
("¿este rol puede en principio hacer esta acción?") + ABAC para el filtro de propiedad
("¿sobre cuáles recursos exactamente?")**, aplicado como una segunda capa después de que RBAC
autoriza la acción en principio.

Esto es consistente con cómo ya funciona el aislamiento de tenant en RFC-003 (RLS + middleware +
repositorio) — la regla de propiedad del médico se implementa con el mismo patrón: un filtro
adicional a nivel de repositorio (`WHERE doctor_id = :actorId` cuando el actor es rol `doctor`),
no como una lista de excepciones en el controlador.

## Catálogo de permisos (derivado de los endpoints reales del repo)

Recorrido completo de `*.routes.ts` en gateway + los 5 servicios (`docs/baseline-challenge-4.md`
sección 1). Convención `recurso:acción`.

| Método + ruta | Servicio | Permiso derivado | Hoy: ¿pública o protegida? |
|---|---|---|---|
| `POST /v1/auth/login` | auth | `auth:login` (sin permiso, acceso anónimo) | Pública |
| `POST /v1/auth/refresh` | auth | `auth:refresh` (sin permiso) | Pública |
| `GET /v1/auth/.well-known/jwks.json` | auth | `auth:jwks` (sin permiso) | Pública |
| `POST /v1/users` | auth | `user:create` | Protegida |
| `GET /v1/users` | auth | `user:list` | Protegida |
| `PATCH /v1/users/:id/deactivate` | auth | `user:deactivate` | Protegida |
| `POST /v1/doctors` | doctors | `doctor:create` | Protegida |
| `GET /v1/doctors` | doctors | `doctor:list` | Pública (navegación para reservar) |
| `GET /v1/doctors/:id` | doctors | `doctor:read` | Pública |
| `POST /v1/doctors/:id/availability` | doctors | `doctor:manage_availability` | Protegida |
| `GET /v1/doctors/:id/slots` | doctors | `doctor:read_slots` | Pública |
| `POST /v1/patients` | appointments | `patient:create` | Pública (paciente sin cuenta) |
| `GET /v1/patients/by-email` | appointments | `patient:read` | Pública (evita duplicados al reservar) |
| `GET /v1/patients/:id` | appointments | `patient:read` | Pública |
| `PATCH /v1/patients/:id` | appointments | `patient:update` | Protegida |
| `GET /v1/patients` | appointments | `patient:list` | Protegida |
| `POST /v1/appointments` | appointments | `appointment:create` | Pública (paciente sin cuenta) |
| `GET /v1/appointments/:id` | appointments | `appointment:read` | Pública (posesión del UUID) |
| `PATCH /v1/appointments/:id/cancel` | appointments | `appointment:cancel` | Pública (posesión del UUID) |
| `GET /v1/appointments` | appointments | `appointment:list` | Protegida |
| `PATCH /v1/appointments/:id/complete` | appointments | `appointment:complete` | Protegida |
| `PATCH /v1/appointments/:id/no-show` | appointments | `appointment:mark_no_show` | Protegida |
| `GET /v1/admin/dashboard` | appointments | `dashboard:read` | Protegida |
| `GET /v1/admin/events` | appointments | `audit:read` | Protegida |
| `GET /v1/admin/dead-letter` | appointments | `dead_letter:read` | Protegida |
| `POST /v1/admin/dead-letter/:id/retry` | appointments | `dead_letter:retry` | Protegida |
| `DELETE /v1/admin/dead-letter/:id` | appointments | `dead_letter:remove` | Protegida |
| `GET /v1/dead-letter` | notifications | `dead_letter:read` | Protegida |
| `POST /v1/dead-letter/:id/retry` | notifications | `dead_letter:retry` | Protegida |
| `DELETE /v1/dead-letter/:id` | notifications | `dead_letter:remove` | Protegida |
| `POST /v1/customers` | payments | `payment:create_customer` | Protegida (hoy: llamada interna de Appointments, no expuesta a usuario final) |
| `POST /v1/payment-intents` | payments | `payment:create_intent` | Protegida (interna) |
| `POST /v1/payment-intents/:id/cancel` | payments | `payment:cancel_intent` | Protegida (interna) |
| `POST /v1/refunds` | payments | `payment:refund` | Protegida (admin, según `docs/architecture/C4-nivel2-contenedores.md`) |
| `POST /v1/webhooks/stripe` | payments | — (no es un permiso de usuario; autenticado por firma de Stripe, no por JWT) | Pública (firma verificada) |
| `GET /v1/platform/dashboard` | appointments | `platform_dashboard:read` (Fase 6, ADR-017) | Protegida, solo plano de plataforma |
| `GET /v1/platform/metrics` | appointments | `platform_dashboard:read` (Fase 6, ADR-017) | Protegida, solo plano de plataforma |
| `GET /v1/platform-users/active` | auth | `platform_dashboard:read` (Fase 6, ADR-017) | Protegida, solo plano de plataforma |

**Gap detectado, no un permiso de este sistema todavía:** el ejemplo del plan maestro
(`patient:read_medical_history`) no tiene equivalente real — el sistema no almacena historial
clínico ni notas médicas hoy (solo agenda, pago y notificación). Si en algún momento se agrega ese
dato, este permiso debe crearse entonces; no se incluye en la matriz por no existir el recurso.

## Matriz rol × permiso

Roles de plataforma (`platform_admin`, `platform_support`) y de tenant (`clinic_owner`,
`clinic_admin`, `doctor`, `receptionist`, `patient`). **Ninguno de estos 7 roles existe hoy en el
código** — hoy solo hay `ADMIN`/`STAFF` sin distinción de alcance.

Principio decidido (2026-07-29) que resuelve la mayoría de las celdas: **`clinic_owner` tiene
capacidades administrativas y financieras exclusivas** (gestión de usuarios/staff, alta de
doctores, refunds, auditoría completa) que **`clinic_admin` no tiene** — `clinic_admin` opera el
día a día (citas, pacientes, disponibilidad de doctores) sin esas capacidades superiores. Esto
refleja el patrón habitual de SaaS B2B: `clinic_owner` es quien contrató el servicio y responde
por la cuenta; `clinic_admin` es personal operativo con permisos delegados.

`✓` = permitido. `✓ (propio)` = permitido solo sobre recursos propios (regla ABAC). `—` = no
aplica.

| Permiso | platform_admin | platform_support | clinic_owner | clinic_admin | doctor | receptionist | patient |
|---|---|---|---|---|---|---|---|
| `auth:login` / `auth:refresh` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — (paciente no tiene cuenta hoy) |
| `user:create` | ✓ | — | ✓ | — | — | — | — |
| `user:list` | ✓ | ✓ (auditado) | ✓ | ✓ | — | — | — |
| `user:deactivate` | ✓ | — | ✓ | — | — | — | — |
| `doctor:create` | ✓ | — | ✓ | — | — | — | — |
| `doctor:list` / `doctor:read` / `doctor:read_slots` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (pública) |
| `doctor:manage_availability` | ✓ | — | ✓ | ✓ | ✓ (propio) | — | — |
| `patient:create` | ✓ | — | — | — | — | ✓ | ✓ (self-service, público) |
| `patient:read` (single) | ✓ | ✓ (auditado) | ✓ | ✓ | ✓ (propio, ver nota) | ✓ | ✓ (pública, por posesión) |
| `patient:list` | ✓ | ✓ (auditado) | ✓ | ✓ | — | ✓ | — |
| `patient:update` | ✓ | — | ✓ | ✓ | — | ✓ | — |
| `appointment:create` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ (self-service, público) |
| `appointment:read` (single) | ✓ | ✓ (auditado) | ✓ | ✓ | ✓ (propio) | ✓ | ✓ (pública, por posesión) |
| `appointment:list` | ✓ | ✓ (auditado) | ✓ | ✓ | ✓ (propio) | ✓ | — |
| `appointment:cancel` | ✓ | — | ✓ | ✓ | ✓ (propio) | ✓ | ✓ (pública, por posesión) |
| `appointment:complete` | ✓ | — | ✓ | ✓ | ✓ (propio) | ✓ | — |
| `appointment:mark_no_show` | ✓ | — | ✓ | ✓ | ✓ (propio) | ✓ | — |
| `dashboard:read` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `audit:read` | ✓ | ✓ | ✓ | — | — | — | — |
| `dead_letter:read/retry/remove` | ✓ | ✓ (justificado) | — | — | — | — | — |
| `payment:create_customer/create_intent/cancel_intent` | ✓ | — | — | — | — | — | — (llamada interna, no expuesta) |
| `payment:refund` | ✓ | — | ✓ | — | — | — | — |
| `platform_dashboard:read` | ✓ | ✓ | — | — | — | — | — |

**Decisiones que resolvieron celdas específicas (2026-07-29):**
- `doctor:cancel` (dentro de `appointment:cancel`): el doctor **sí** puede cancelar sus propias
  citas, con la misma regla ABAC de propiedad que `appointment:complete`/`mark_no_show`
  (`appointment.doctorId === actor.id`).
- `receptionist`: alcance operativo completo sobre citas y pacientes (crear, listar, actualizar,
  cancelar, completar, marcar no-show), **sin** `doctor:manage_availability` ni las capacidades de
  `clinic_owner` (gestión de usuarios, alta de doctores, refunds).

**Nota sobre `doctor` y `patient:read`:** un médico solo debería ver los datos de los pacientes que
tienen cita con él, no el listado completo de pacientes de la clínica — esta es exactamente la
regla ABAC del contexto (filtro `appointment.doctorId === actor.id`, y de ahí a
`appointment.patientId`), no un permiso adicional.

## Reglas de scope

- **Tenant:** todo permiso de tenant se evalúa dentro del `tenant_id` del actor (RFC-003) —
  ninguna celda de la matriz anterior aplica cross-tenant salvo los roles de plataforma.
- **Clínica-sucursal:** **no aplica hoy.** El modelo de datos actual no tiene concepto de sucursal
  dentro de una clínica (una clínica = un conjunto de doctores/pacientes/citas, sin jerarquía
  interna). Si se introduce en el futuro, el scope de sucursal se agregaría como un nivel
  intermedio entre tenant y recurso — no es necesario para el alcance de este challenge.
- **Propiedad del recurso (ABAC):** aplica a `doctor` sobre `appointment`/`patient`
  (`doctorId === actor.id`), y de forma más limitada al propio paciente sobre su propia cita
  (posesión del UUID, no un `patientId` en el JWT porque el paciente no tiene cuenta).

## Roles personalizados por tenant

**Decidido (2026-07-29): no en v1.** Los 5 roles de tenant cubren los casos reales del dominio y
agregar roles a medida multiplica la superficie de la matriz de permisos sin necesidad demostrada.
El esquema de permisos (`recurso:acción` como catálogo plano, no enum cerrado) debe poder
soportarlo más adelante sin romper cambios de esquema (consistente con `packages/authz/` de
ADR-012), pero la UI/API de administración de roles personalizados no se construye en este
challenge.

## Autorización servicio-a-servicio

El sistema ya tiene un patrón de límite de confianza de red interna documentado
(`services/auth/src/modules/users/users.routes.ts`, `gateway/src/routes/proxy.ts`): el gateway
verifica el JWT una sola vez y reenvía el rol en un header interno `x-internal-user-role`; los
servicios de "atrás" confían en que solo el gateway puede alcanzarlos.

**Esto no debe extenderse tal cual al aislamiento de tenant.** Un servicio interno (ej.
`AppointmentsService` llamando a `DoctorsClient`) nunca debe poder omitir el filtro de tenant
"porque es una llamada de servicio, no de usuario final" — el `tenant_id` debe viajar en esas
llamadas igual que viaja `x-internal-user-role` hoy (ver backlog ítem 4, ya detectado en Fase 0:
`DoctorsClient`/`PaymentsClient` no propagan ni siquiera `requestId` hoy). La distinción
correcta es: una llamada servicio-a-servicio *hereda* el tenant de la operación de negocio que la
originó, nunca opera "sin tenant" ni "con todos los tenants" salvo que sea explícitamente una
operación de plataforma (ej. un job de purga de retención, Fase 5), y esas excepciones deben
pasar por un rol de aplicación distinto (no el mismo pool sin `BYPASSRLS`).

## Escalada de privilegios: acceso de soporte de plataforma

Un `platform_support` que necesite ver datos de un tenant específico (para resolver un ticket, por
ejemplo) no debe tener acceso permanente. Flujo requerido (a construir en Fase 4):
1. Solicitud con motivo obligatorio (texto libre, no opcional).
2. Concesión de acceso **temporal**, con expiración corta (horas, no días).
3. El acceso queda registrado en el audit log inmutable (Fase 5) con el motivo, no solo con el
   hecho de haber accedido.
4. Notificación al tenant de que un miembro de la plataforma accedió a sus datos, con el motivo.

Esto corresponde a la fila `platform_support` de la matriz marcada "(auditado)" — el permiso existe,
pero nunca sin las cuatro condiciones anteriores.

## Preguntas abiertas para el humano

Todas las preguntas abiertas originales de este RFC se resolvieron el 2026-07-29 (ver la matriz y
las decisiones anotadas debajo de ella). Resumen de lo decidido:

1. `clinic_owner` tiene capacidades administrativas/financieras exclusivas
   (`user:*`, `doctor:create`, `payment:refund`, `audit:read` completo) que `clinic_admin` no
   tiene; `clinic_admin` opera el día a día sin esas capacidades superiores.
2. `receptionist` tiene alcance operativo completo sobre citas y pacientes (incluidos
   cancelar/completar/marcar no-show), sin gestión de disponibilidad de doctores ni las
   capacidades exclusivas de `clinic_owner`.
3. `doctor` sí puede cancelar sus propias citas (regla ABAC de propiedad), además de completarlas
   y marcarlas no-show.
4. No se soportan roles personalizados por tenant en v1; el esquema de permisos queda abierto para
   soportarlo después sin romper cambios de esquema.
5. `payment:refund` queda exclusivo de `clinic_owner` (no de `clinic_admin`), sin tope de monto
   adicional definido en este RFC — si se necesita un tope, es una regla de negocio a nivel de
   `payments.service.ts`, no un permiso adicional.

Sin preguntas pendientes para pasar a la Fase 4 (implementación del motor de permisos,
`packages/authz/`, ADR-012).

## Changelog

- **2026-07-31 (Fase 6, ADR-017):** agregado el permiso `platform_dashboard:read` (catálogo y
  matriz), exclusivo del plano de plataforma (`platform_admin`/`platform_support`, `none` para
  los 5 roles de tenant) — cubre `GET /v1/platform/dashboard` y `GET /v1/platform/metrics`
  (Appointments) y `GET /v1/platform-users/active` (Auth), el backend del dashboard ejecutivo. No
  se modificó ninguna celda ni decisión existente de la matriz original.
