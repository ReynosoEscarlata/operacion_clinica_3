# Plan de ejecución — Challenge 4: "Romper el monolito"

> **Estado (actualizado 2026-07-31): Completado.** Este plan es histórico — el monolito ya está
> partido en los 5 servicios + gateway que describe, y el proyecto avanzó a un challenge
> posterior (SaaS multi-tenant en AWS, ver `claude/PLAN-challenge-5-plataforma-para-todos.md`).
> Los checkboxes de las secciones 1 y 3 se actualizaron abajo contra evidencia real del repo, no
> de memoria — ver el detalle junto a cada ítem. El "broker de eventos: Redis Streams" del
> supuesto original quedó superado: se migró a SNS/SQS/EventBridge Scheduler en el Challenge 5
> (ADR-014, Fase 3b) — Redis sigue en `docker-compose.yml` únicamente para el monolito legado.

## 0. Contexto e instrucciones para Claude Code

Eres mi asistente de ingeniería para refactorizar la plataforma del **Challenge 3** (5 clínicas, monolito Node.js + Postgres) en una arquitectura de microservicios. Trabajamos sobre **el mismo aplicativo**.

**Tienes permiso explícito para modificar el `spec.md` existente** y adaptarlo a este challenge: actualiza secciones obsoletas del monolito, agrega las secciones de servicios/contratos/eventos/observabilidad que falten, y mantén un changelog al final del `spec.md` con cada cambio que hagas. **No borres** historia del challenge 3 sin marcarla como "migrada" o "deprecada"; el flujo end-to-end del challenge 3 debe seguir documentado y funcionando.

### Reglas no negociables (guardrails)

1. **No decides los bounded contexts.** Cuando llegue ese punto, generas un borrador de RFC con preguntas guía y opciones, y **esperas mi aprobación** antes de codear. Nada de "porque funciona".
2. **Estrategia strangler fig, no big-bang.** El E2E del challenge 3 debe pasar verde en cada commit. Si un cambio lo rompe, lo revertimos.
3. **Cero estado compartido entre servicios.** Ningún servicio consulta la BD de otro. Si dos servicios necesitan el mismo dato, se publica como evento. Vigila esto en cada PR.
4. **La reserva de citas NO depende síncronamente de Notifications.** Appointments publica un evento; nunca hace `await fetch(notifications)`. Esto se diseña desde la Fase 0, no al final.
5. **Cada decisión arquitectónica va a un ADR o al RFC**, con justificación y trade-offs. Si no está justificada, no se mergea.
6. **Code review estricta a todo lo que toque contratos públicos** (OpenAPI, esquemas de eventos, rutas del gateway).
7. El **PR cronometrado de SMS será sin IA**, así que el diseño debe ser entendible por un humano: prioriza claridad sobre cleverness.

### Supuestos (corrígeme si no aplican antes de empezar)

- Monolito actual: **Node.js + Postgres**.
- Repo: **monorepo** (`paths` filters en CI para deploy independiente por servicio).
- Broker de eventos: **Redis Streams** (más simple que RabbitMQ para arrancar; cumple el requisito).
- Gateway: **Express/Fastify** como reverse proxy + auth (Kong/Traefik queda como stretch).

---

## 1. Objetivo y criterios de aceptación

**Misión:** partir el monolito en ≥3 servicios independientes (Auth, Appointments, Notifications) con API gateway, contratos OpenAPI 3.1, comunicación HTTP + eventos, y CI/CD que despliega cada servicio por separado.

**Done cuando:**

- [x] El flujo end-to-end del challenge 3 sigue funcionando.
- [x] Tirar Notifications **no** rompe la reserva de citas (degraded mode: las citas se crean igual)
      — verificado con el stack real en Docker, ver `SPEC.md` changelog, entrada 2026-06-21.
- [x] El pipeline despliega cada servicio de forma independiente (`.github/workflows/*-ci.yml`, un
      workflow por servicio con `paths:` filters).
- [x] Dashboard de métricas RED visible con datos reales (`infra/grafana/provisioning/dashboards/json/red-metrics.json`).
- [x] Documentación de contratos pública (`GET /docs` en el gateway, agregando el OpenAPI de cada servicio).
- [x] Cada PR pasa tests de contrato automatizados (Pact, ver `pacts/*.json` y `tests/contract/` de cada servicio).

---

## 2. Plan por fases

### Fase 0 — Diseño (Semana 1) · SIN código de servicios

Esto es lo que la rúbrica exige "antes de partir". Es la fase de mayor peso para el nivel senior.

**Tareas para Claude Code:**

1. Generar borrador de **`RFC-001-bounded-contexts.md`** con preguntas guía (no respuestas): ¿quién es la fuente de verdad de `usuario`, `cita`, `notificación enviada`? ¿Dónde están las fronteras transaccionales? ¿Appointments valida usuario por JWT (llave pública de Auth, sin tocar su BD) o por read-model local poblado por eventos? Presentar 2 opciones por pregunta con trade-offs. **Esperar aprobación.**
2. Tras aprobación, redactar los **contratos OpenAPI 3.1** (uno por servicio) en `packages/contracts/`. Versionado en URL (`/v1/...`). Incluir errores y esquemas de eventos (`UserCreated`, `AppointmentCreated`, etc.).
3. Redactar **3 ADRs**:
   - `ADR-001-sync-vs-async.md`: HTTP síncrono para queries, eventos asíncronos para efectos secundarios. Justificar criterio.
   - `ADR-002-transacciones-distribuidas.md`: sin 2PC; consistencia eventual + **patrón Outbox** para publicación confiable de eventos. Saga solo si hay flujo multi-paso reversible.
   - `ADR-003-versionado-apis.md`: cambios aditivos, deprecación, `/v1` → `/v2`.
4. Generar **diagrama C4 nivel 2** (contenedores) en formato Mermaid dentro del repo. Cada flecha etiquetada como HTTP o evento.
5. **Actualizar `spec.md`**: nueva sección "Arquitectura de servicios" + referencia al RFC, ADRs y C4. Marcar lo del monolito como "en migración".

**Gate de salida:** RFC + 3 OpenAPI + 3 ADR + C4 en PR, aprobados por mí.

### Fase 1 — Infra base y andamiaje (Semana 2)

1. Estructura de monorepo: `services/{auth,appointments,notifications}`, `gateway/`, `packages/contracts/`, `infra/`.
2. **Docker Compose**: gateway + 3 servicios (esqueletos) + un Postgres por servicio + Redis. Justificar en ADR si se usan instancias separadas o una con bases separadas.
3. **Gateway** Express/Fastify: reverse proxy + middleware de validación JWT + enrutamiento.
4. **GitHub Actions**: un workflow por servicio con `paths:` filters, de modo que tocar `services/notifications/**` solo dispare su pipeline (= deploy independiente).
5. **Observabilidad cableada**: Prometheus + Grafana (o Grafana Cloud free) en Compose, aunque aún sin métricas reales.

### Fase 2 — Extracción de servicios, strangler fig (Semanas 3–4)

Orden por acoplamiento creciente. **El E2E debe pasar verde en cada paso.**

1. **Auth** (dependencia transversal): login/registro/validación de token. El gateway delega auth aquí; el resto valida JWT con la llave pública.
2. **Appointments** (core): migra lógica y tabla a su BD propia. Introducir **tabla Outbox**: el evento `AppointmentCreated` se escribe en la misma transacción que la cita.
3. **Notifications**: consume eventos y envía. **Diseñar abstracción de canal** (`EmailChannel`, y luego `SmsChannel`) — esto hace trivial el PR cronometrado de SMS.

### Fase 3 — Eventos y degraded mode (Semana 5)

1. Implementar el **relay del Outbox** → publica a Redis Streams.
2. Notifications como **consumer group** con acks, reintentos e **idempotencia** (mismo evento dos veces ≠ dos correos).
3. **Validar la regla central**: apagar Notifications → crear cita → la cita se crea, el evento queda en el stream → Notifications vuelve y procesa el backlog. Documentar la evidencia.

### Fase 4 — Observabilidad y contract tests (Semana 6)

1. **Métricas RED por endpoint** (`prom-client`, endpoint `/metrics`, dashboard Grafana por servicio).
2. Script de carga ligero (k6 o autocannon) para tener **datos reales** en el dashboard durante la demo.
3. **Contract tests en cada PR**, dos capas: (a) validación implementación↔OpenAPI (Schemathesis o validador runtime) y (b) consumer-driven con **Pact** (gateway↔servicios y Appointments↔Notifications, incluyendo el esquema del evento). Conectar como gate de merge.
4. **Docs públicas**: Swagger UI o Redoc por servicio o agregado en el gateway.

### Fase 5 — Hardening, postmortem y demo (Semana 7)

1. **Postmortem simulado** (`POSTMORTEM-notifications-peak.md`): "se cayó Notifications en horario pico" — qué pasó (lag del consumer, backlog en el stream), cómo se detectó (alerta de Duration/lag en Grafana), cómo se arregló (reinicio + reproceso vía Outbox). Tono técnico y honesto.
2. **Ensayo de demo**: correr todo, tirar un servicio en vivo, mostrar degradación con gracia, explicar cada flecha del C4.
3. **Ensayo del PR de SMS sin IA**: si toma >3h, el diseño de Notifications quedó mal — corregir ahora.

### Fase 6 — Buffer y stretch goals (Semana 8)

Buffer para deuda + stretch en orden de valor: **OpenTelemetry + Jaeger** (tracing distribuido) → feature flags (Flagsmith self-hosted) → job de chaos que mata un contenedor cada hora en staging.

---

## 3. Entregables finales

- [x] Repo (monorepo) con CI/CD funcional por servicio (`.github/workflows/`).
- [x] `RFC-001-bounded-contexts.md` aprobado **antes** de codear.
- [x] `ADR-001`, `ADR-002`, `ADR-003` (además `ADR-004-postgres-por-servicio.md`, no listado
      originalmente pero del mismo espíritu).
- [ ] `POSTMORTEM-notifications-peak.md` — **no se generó como archivo dedicado.** El ensayo real
      de degraded mode (sección 2, Fase 5) sí se ejecutó y quedó documentado inline en el
      changelog de `SPEC.md` (entrada 2026-06-21, con los pasos, `XINFO GROUPS` y verificación de
      catch-up del backlog) — cubre la evidencia que pedía este entregable, pero no en el formato
      de postmortem simulado independiente que describía la Fase 5. Deuda menor, no bloqueante.
- [x] Diagrama C4 nivel 2 (Mermaid) — `docs/architecture/C4-nivel2-contenedores.md` (nota: quedó
      desactualizado por cambios posteriores del Challenge 5, ver nota de vigencia en ese archivo).
- [x] `spec.md` actualizado con changelog de cambios del challenge 4 (sección "Changelog (Challenge 4)").
- [x] Dashboard Grafana + docs OpenAPI públicas.

**Fase 6 (buffer/stretch goals) — no ejecutada como se planteó:** ni OpenTelemetry+Jaeger, ni
feature flags (Flagsmith), ni el job de chaos se implementaron. El tracing distribuido sí se
resolvió, pero con AWS X-Ray en el Challenge 5 (ADR-017) en vez de OTel+Jaeger — decisión posterior
con más contexto (todo el resto del stack ya era AWS-nativo). El canal `SmsChannel` (Fase 2,
paso 3) tampoco se implementó — solo existe `EmailChannel`; la abstracción `NotificationChannel`
que lo haría trivial sí quedó lista.

---

## 4. Riesgos a vigilar en code review

- **Estado compartido sutil:** un `SELECT` a la BD de otro servicio "solo para validar" ya viola la regla.
- **Acoplamiento síncrono escondido:** un `await fetch(notifications)` en la creación de cita mata el degraded mode aunque "funcione".
- **CI que no aísla:** sin `paths` filters, todo se redespliega junto y no se cumple "deploy independiente".

---

## 5. Reparto de trabajo con Claude Code

| Sí (delegar) | No (decido yo / sin IA) |
|---|---|
| Refactors mecánicos de extracción | Definir los bounded contexts |
| Generar tests de contrato y de carga | Aceptar "porque funciona" como justificación |
| Configurar pipelines y Docker Compose / IaC | Aprobar cambios a contratos públicos |
| Borradores de RFC/ADR/C4 | El PR cronometrado de SMS (sin IA) |

---

**Siguiente acción sugerida:** "Lee este plan y la versión actual de `spec.md`. Empieza la Fase 0: genera el borrador de `RFC-001-bounded-contexts.md` con las preguntas guía y opciones, sin codear ni decidir por mí. Cuando esté, lo reviso."
