# Backlog de deuda técnica — post-Challenge 4

Clasificación según `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 0:
**[BLOQUEA-MULTITENANCY]** / **[BLOQUEA-PRODUCCION]** / **[PUEDE-ESPERAR]**.

Fuente: inventario de `docs/baseline-challenge-4.md`.

---

## BLOQUEA-MULTITENANCY

1. **Ninguna tabla tiene `tenant_id`/`clinic_id` (Supuesto S5, falso)** — todo el modelo de datos
   (monolito + 5 servicios) fue diseñado para una sola clínica. La Fase 3 no es un ajuste de
   esquema, es migración + backfill sobre `Patient`, `Appointment`, `Doctor`, `User`, y todas las
   tablas `OutboxEvent`/`DeadLetterEntry`/snapshots que llevan payloads con datos de tenant
   implícitos. Justificación: es la base de todo lo demás — sin esto no hay RLS, no hay
   enforcement, no hay nada que aislar.

2. **El envelope de eventos no lleva `tenant_id`** — `AppointmentCreated`, `PaymentSucceeded`,
   etc. no tienen ningún campo de tenant en su payload (ver sección 4 del baseline). Un evento sin
   `tenant_id` hoy simplemente no podría enrutarse ni validarse por tenant en consumo. Justificación:
   bloquea directamente el punto 5 de la Fase 3 ("tenant_id obligatorio en el envelope").

3. **Namespacing ausente en Redis** — las claves de BullMQ y el stream `domain-events` no tienen
   ningún prefijo de tenant (de hecho, el monolito y `appointments` comparten el mismo Redis físico
   sin namespace de servicio siquiera). Justificación: bloquea el punto 6 de la Fase 3 (namespacing
   de claves).

4. **`DoctorsClient`/`PaymentsClient` (llamadas HTTP internas de Appointments) no propagan ningún
   contexto de tenant ni de request** — se necesitará inyectar el `tenant_id` del JWT en estas
   llamadas síncronas también, no solo en la capa de repositorio. Justificación: si el contexto de
   tenant solo vive en el middleware HTTP de entrada pero no viaja a las llamadas salientes,
   aparecerá una fuga de aislamiento en el primer servicio-a-servicio que se audite.

5. **No hay motor de permisos ni distinción de roles de plataforma vs. tenant** — hoy solo existen
   `ADMIN`/`STAFF` en Auth, sin concepto de `platform_admin`/`platform_support` ni de scoping por
   tenant. Justificación: precondición de RFC-003/Fase 4, pero afecta directamente el diseño de
   `User` en la Fase 3 (¿el usuario pertenece a un tenant o es cross-tenant?).

## BLOQUEA-PRODUCCION

6. **Auth escribe a su tabla `OutboxEvent` pero no tiene `outbox-relay.ts`** — `UserCreated`/
   `UserDeactivated` quedan con `publishedAt: null` para siempre, nunca llegan a Redis Streams. Es
   el único de los cinco servicios con el patrón Outbox incompleto (Doctors, Appointments y
   Payments sí tienen relay). Justificación: un patrón "implementado a medias" es peor que no
   implementarlo — da falsa confianza de que el evento se publicó. Corregir antes de que cualquier
   consumidor futuro dependa de `UserCreated`.

7. **`RefundIssued` no tiene consumidor detectado** — se publica desde Payments pero ningún
   servicio lo consume en el código actual. Justificación: o es un evento muerto que se puede
   eliminar (menos superficie), o falta un consumidor real (ej. Notifications debería avisar al
   paciente del reembolso) — cualquiera de los dos casos es una brecha que hay que resolver, no
   dejar ambigua.

8. **Correlación de requestId rota entre servicios (Supuesto S6, parcial)** — **RESUELTO en Fase 6
   (ADR-017)**: `gateway/src/middleware/request-id.ts` ahora genera/reenvía `x-request-id` (antes
   el gateway no lo hacía en absoluto), y `DoctorsClient`/`PaymentsClient` lo propagan en sus
   llamadas síncronas (antes no mandaban ese header). Seguir una request de punta a punta en los
   logs de más de un servicio ya es confiable — ver `docs/runbooks/consultas-logs-insights.md`.

9. **Llave de firma JWT de Auth vive en memoria del proceso** (documentado en el propio
   `services/auth/src/lib/keys.ts`) — un reinicio del servicio rota el `kid` e invalida todos los
   tokens emitidos antes. Justificación: en un entorno multi-instancia (ECS Fargate con >1 task) o
   con despliegues frecuentes, esto invalida sesiones de forma impredecible. Debe resolverse antes
   de Fase 2 (fundación AWS), donde Auth correrá con más de una réplica.

10. **Secretos en texto plano en `docker-compose.yml`** (`STRIPE_SECRET_KEY`,
    `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` con defaults `_dummy`) — esperado para desarrollo
    local, pero confirma que no existe hoy ningún mecanismo de secret management. Justificación:
    precondición literal de la Fase 2 (Secrets Manager con rotación).

11. **Colisión potencial de nombres de cola entre el monolito y `appointments`** — ambos usan el
    mismo Redis físico y nombres de cola BullMQ iguales o similares (`appointment-reminders`,
    `appointment-expiration`, `appointment-noshow`) sin namespace por servicio. Justificación: si
    ambos llegaran a correr contra el mismo Redis con el mismo nombre de cola, un worker podría
    procesar jobs del otro sistema. Hoy es tráfico simulado, pero es la clase de bug que sobrevive
    silenciosamente a un refactor.

12. **No existe documento de contrato de eventos versionado (AsyncAPI o equivalente)** — el
    "contrato" real de los eventos de dominio vive implícitamente en los fixtures de Pact y en el
    código de cada consumer/producer. Justificación: sin este documento, la Fase 3 (que exige
    agregar `tenant_id` obligatorio al envelope) no tiene una fuente única de verdad de qué
    payloads existen hoy — hay que derivarlos leyendo código servicio por servicio, como se hizo
    en este inventario.

## PUEDE-ESPERAR

13. **Columnas `Json`/texto libre sin clasificación definitiva de PII** —
    `AppointmentEvent.payload`, `IdempotencyRecord.response`, `NotificationLog.error`,
    `Appointment.cancellationReason` — marcadas "REVISAR" en el baseline porque su contenido real
    depende de datos en tiempo de ejecución. Justificación: no bloquea el arranque de la Fase 1,
    pero debe resolverse antes del Gate de la Fase 5 (compliance), inspeccionando datos reales de
    un entorno de test poblado.
    **Actualización 2026-07-31:** la Fase 5 se cerró (`docs/compliance/inventario-datos-personales.md`)
    sin hacer esta inspección puntual — el audit log cubre el *acceso* a los recursos que contienen
    estas columnas (Patient/Appointment/etc.), pero no se clasificó el contenido real de estas 4
    columnas específicas. Sigue abierto; no se marca resuelto para no reportar falsamente el Gate
    de Fase 5 como completo en este punto.

14. **Esquemas `Doctor`/`Availability` duplicados casi idénticos entre el monolito y el servicio
    `doctors`** — no es una violación de "un solo dueño" (cada uno tiene su propia tabla en su
    propia DB), pero genera confusión de lectura al auditar el repo. Justificación: cosmético,
    relevante solo si se decide retirar el monolito antes de lo esperado.

15. **`DoctorSnapshot` en Notifications se actualiza pero nunca se lee** (los templates de email no
    incluyen nombre de doctor) — gap ya documentado en `SPEC.md`, heredado del monolito (no es una
    regresión). Justificación: no afecta tenancy, compliance ni seguridad; es una mejora de
    producto que puede esperar indefinidamente.

16. **Sin Pact Broker** — los `.json` de contratos se commitean a mano en `pacts/`, dependiendo de
    que el desarrollador recuerde regenerarlos. Ya documentado como limitación aceptada en
    `SPEC.md`. Justificación: razonable para 5 servicios; solo se vuelve bloqueante si el número de
    servicios crece significativamente (fuera del alcance de este challenge).

17. **Sin feature flags** — quedó como stretch goal del Challenge 4 y nunca se implementó.
    Justificación: no es requisito de ningún gate del Challenge 5.

---

## Resumen para Gate 0

- **5 ítems** bloquean multitenancy directamente — todos dentro del alcance esperado de la Fase 3,
  ninguno es una sorpresa que cambie el orden de fases.
- **7 ítems** bloquean producción — la mayoría tiene una fase natural donde resolverse (Fase 2 para
  secretos/llaves, Fase 6 para correlación, Fase 3 para el gap de Auth y el evento huérfano). Ninguno
  requiere una fase nueva fuera de las 10 ya planeadas.
- **5 ítems** pueden esperar — ninguno tiene impacto en tenancy, compliance o seguridad.

Nada de lo encontrado invalida el mapa de fases del plan maestro. El hallazgo más significativo
(Supuesto S5 falso) ya estaba anticipado explícitamente por el propio plan ("si S5 es falso, la
Fase 3 crece de forma significativa") y no requiere replantear el orden de fases, solo confirmar
que la Fase 3 va a incluir migración + backfill real sobre datos existentes, no solo agregar una
columna.
