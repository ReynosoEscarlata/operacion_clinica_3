# Plan de Desarrollo — "Operación Clínica"

## Sistema de Reserva de Citas con Cobro Online

> **Objetivo**: Plan fase-por-fase para desarrollar con Claude Code.
> Cada fase incluye el prompt exacto que puedes copiar a Claude Code y los archivos esperados como resultado.

---

## Fase 0 — Diseño Previo ✅ COMPLETADA

**Estado**: Terminada. Decisiones de diseño tomadas por el desarrollador.
**Entregable**: `SPEC.md` (incluido en el repo)

### Decisiones de diseño tomadas:

1. **CONFIRMED y PAID son estados separados**: CONFIRMED se dispara al crear el PaymentIntent en Stripe (intención de cobro). PAID se dispara cuando llega el webhook `payment_intent.succeeded`.

2. **Cancelación desde 4 estados**: PENDING, CONFIRMED, PAID y REMINDED. Cada uno con política distinta de refund:
   - PENDING → sin cobro, sin refund
   - CONFIRMED → cancelar PaymentIntent, sin cobro
   - PAID/REMINDED ≥24h antes → refund completo
   - PAID/REMINDED <24h antes → refund 50% (penalización)

3. **NO_SHOW automático**: Cron job cada 15 minutos marca como NO_SHOW las citas en estado REMINDED cuyo `dateTime + 1 hora < now`.

4. **7 estados en total**: PENDING → CONFIRMED → PAID → REMINDED → COMPLETED | CANCELLED | NO_SHOW

### Archivos generados:

- `SPEC.md` — Diagrama de estados (Mermaid), tabla de transiciones, matriz de errores (pagos, email, infra, concurrencia), diagrama de secuencia del flujo completo, flujo de cancelación, políticas del sistema, y endpoints.

### Para la evaluación:

Debes poder dibujar el diagrama de estados en pizarra y explicar:
- Por qué CONFIRMED y PAID son estados distintos (porque el PaymentIntent se crea antes del cobro real)
- Qué pasa si un webhook llega duplicado (tabla WebhookEvent con stripeEventId unique)
- Por qué el NO_SHOW es automático y no manual (reduce carga operativa del admin)
- La lógica de refund parcial vs completo (umbral de 24h)

---

## Fase 1 — Scaffold del Proyecto

**Duración**: 1–2 días

### Prompt para Claude Code:

```
Inicializa un proyecto Node.js con TypeScript para una API REST de clínica médica.

Stack:
- Runtime: Node.js + TypeScript (tsconfig strict)
- Framework: Fastify
- ORM: Prisma con PostgreSQL
- Queue: BullMQ + Redis (ioredis)
- Pagos: Stripe (modo test)
- Email: Resend
- Logging: Pino con request_id propagado
- Error tracking: Sentry
- Testing: Vitest + Supertest
- Linter: ESLint + Prettier
- CI: GitHub Actions (lint + test en cada push)

Estructura de carpetas:
src/
  config/          # env vars, stripe, redis, sentry init
  modules/
    appointments/  # routes, controller, service, repository
    patients/      # routes, controller, service, repository  
    doctors/       # routes, controller, service, repository
    payments/      # webhook handler, service
    notifications/ # email service, templates
  queues/          # workers, job definitions, retry strategies
  middleware/      # auth, request-id, error-handler
  lib/             # shared utilities, logger, idempotency
  prisma/          # schema.prisma, migrations, seed

Incluye:
- docker-compose.yml con PostgreSQL y Redis
- .env.example con todas las variables necesarias
- tsconfig.json estricto
- Makefile con comandos: dev, test, lint, migrate, seed
- README.md con setup instructions

NO generes lógica de negocio aún, solo el scaffold con un health check.
```

### Archivos esperados:

```
clinic-scheduler/
├── .github/workflows/ci.yml
├── docker-compose.yml
├── .env.example
├── Makefile
├── package.json
├── tsconfig.json
├── .eslintrc.js
├── .prettierrc
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   │   ├── env.ts
│   │   ├── stripe.ts
│   │   ├── redis.ts
│   │   ├── sentry.ts
│   │   └── email.ts
│   ├── middleware/
│   │   ├── request-id.ts
│   │   ├── error-handler.ts
│   │   └── auth.ts
│   ├── lib/
│   │   ├── logger.ts
│   │   └── idempotency.ts
│   └── modules/ (vacíos con index.ts placeholder)
├── prisma/
│   └── schema.prisma (solo datasource + generator)
└── tests/
    └── health.test.ts
```

### Verificación:

```bash
docker compose up -d
make dev        # server arranca sin errores
make test       # health check pasa
make lint       # sin warnings
```

---

## Fase 2 — Base de Datos y Modelos

**Duración**: 2–3 días

### Prompt para Claude Code:

```
Crea el schema de Prisma para el sistema de citas clínicas.

Modelos necesarios:

Patient:
  - id (uuid), email (unique), name, phone, stripeCustomerId (nullable)
  - timestamps

Doctor:
  - id (uuid), name, email, specialty
  - timestamps

Availability:
  - id, doctorId (FK), dayOfWeek (0-6), startTime, endTime
  - Para definir horarios recurrentes del doctor

Appointment:
  - id (uuid), patientId (FK), doctorId (FK)
  - dateTime (fecha y hora de la cita)
  - durationMinutes (default 30)
  - status: enum AppointmentStatus { PENDING CONFIRMED PAID REMINDED COMPLETED CANCELLED NO_SHOW }
  - cancellationReason (nullable)
  - stripePaymentIntentId (nullable, unique)
  - paidAt, confirmedAt, remindedAt, completedAt, cancelledAt (timestamps nullable)
  - timestamps

AppointmentEvent:
  - id, appointmentId (FK)
  - type: enum EventType { CREATED STATUS_CHANGED PAYMENT_RECEIVED PAYMENT_FAILED EMAIL_SENT EMAIL_FAILED WEBHOOK_RECEIVED REMINDER_SENT CANCELLED RESCHEDULED }
  - payload (Json)
  - createdAt
  - Esto es el audit log de cada cita

IdempotencyRecord:
  - id, key (unique), response (Json), createdAt
  - TTL de 24h (limpieza con cron)

WebhookEvent:
  - id, stripeEventId (unique), type, payload (Json), processedAt (nullable)
  - Para deduplicación de webhooks de Stripe

Incluye:
- Índices en: appointment.status, appointment.dateTime, webhookEvent.stripeEventId
- Relaciones con onDelete apropiado
- Seed con 3 doctores, 5 pacientes, y disponibilidad de ejemplo

Genera la migración inicial y el seed.
```

### Verificación:

```bash
npx prisma migrate dev --name init
npx prisma db seed
npx prisma studio   # ver datos en el browser
```

---

## Fase 3 — Configuración de Infraestructura

**Duración**: 1–2 días

### Prompt para Claude Code:

```
Configura la infraestructura del proyecto:

1. Logger (Pino):
   - Formato JSON en producción, pretty en desarrollo
   - Cada request debe tener un requestId (uuid v4) propagado en todos los logs
   - El requestId se genera en un middleware de Fastify y se inyecta en el contexto
   - Helper: logger.child({ requestId, module: 'payments' })

2. Sentry:
   - Inicialización en src/config/sentry.ts
   - Integración con Fastify (plugin @sentry/node)
   - Captura automática de errores no manejados
   - Tags: environment, requestId
   - Breadcrumbs para operaciones de Stripe y BullMQ

3. Error Handler Global:
   - Middleware de Fastify que captura todos los errores
   - Errores conocidos (AppError custom class) → respuesta estructurada con código HTTP
   - Errores desconocidos → log + Sentry + 500 genérico al cliente
   - Nunca exponer stack traces en producción
   - Clase AppError con: statusCode, code (string), message, isOperational

4. Redis:
   - Conexión con ioredis
   - Health check endpoint
   - Graceful shutdown (cerrar conexiones)

5. Stripe:
   - Cliente inicializado con API key de env
   - Webhook secret de env

Escribe tests para:
- El middleware de requestId (que se propaga correctamente)
- El error handler (AppError vs Error genérico)
- Health check que verifica DB + Redis
```

---

## Fase 4 — Módulo de Pacientes y Doctores (CRUD base)

**Duración**: 2–3 días

### Prompt para Claude Code:

```
Implementa los módulos de Patients y Doctors.

Para cada módulo sigue esta arquitectura:
- routes.ts: definición de rutas Fastify con schema de validación (JSON Schema o Typebox)
- controller.ts: extrae params, llama al service, retorna response
- service.ts: lógica de negocio
- repository.ts: queries Prisma

Patients:
  POST   /api/patients          → crear paciente
  GET    /api/patients/:id      → obtener paciente con sus citas
  PATCH  /api/patients/:id      → actualizar datos
  GET    /api/patients           → listar con paginación (cursor-based)

  Al crear paciente:
  - Crear Stripe Customer con stripe.customers.create({ email, name })
  - Guardar stripeCustomerId en DB
  - Log evento

Doctors:
  POST   /api/doctors            → crear doctor
  GET    /api/doctors/:id        → obtener doctor con disponibilidad
  GET    /api/doctors             → listar todos
  POST   /api/doctors/:id/availability → definir bloques de disponibilidad
  GET    /api/doctors/:id/slots?date=2025-01-15 → slots disponibles para una fecha
                                   (cruza availability con citas existentes)

Para los slots disponibles:
  - Tomar la availability del doctor para ese día de la semana
  - Dividir en bloques de 30 min
  - Filtrar los que ya tienen cita (status != CANCELLED)
  - Retornar array de { startTime, endTime, available: boolean }

Validación con Typebox:
  - Email válido
  - Teléfono formato correcto
  - Fecha futura para slots

Tests:
  - CRUD completo de pacientes (happy path)
  - Creación de Stripe customer (mockear Stripe)
  - Cálculo de slots disponibles (caso con citas existentes y sin ellas)
  - Validación de inputs incorrectos
```

---

## Fase 5 — Módulo de Citas (Core)

**Duración**: 3–4 días

### Prompt para Claude Code:

```
Implementa el módulo de Appointments, que es el core del sistema.

Rutas:
  POST   /api/appointments              → crear cita (status: PENDING)
  GET    /api/appointments/:id          → detalle con eventos
  GET    /api/appointments               → listar con filtros (status, doctor, patient, fecha)
  PATCH  /api/appointments/:id/cancel   → cancelar cita
  PATCH  /api/appointments/:id/complete → marcar completada (solo admin)
  PATCH  /api/appointments/:id/no-show  → marcar no-show (solo admin)

Flujo de creación:
  1. Validar que el slot está disponible (lock optimista: verificar y crear en transacción)
  2. Crear appointment con status PENDING
  3. Crear PaymentIntent en Stripe:
     - amount: precio de la consulta (configurable por doctor/especialidad)
     - currency: 'mxn'
     - customer: patient.stripeCustomerId
     - metadata: { appointmentId }
  4. Guardar stripePaymentIntentId en la cita
  5. Registrar AppointmentEvent: CREATED
  6. Retornar al cliente: appointment + clientSecret del PaymentIntent
  7. La cita tiene TTL: si no se paga en 30 min, un job la cancela automáticamente

Reglas de transición de estado (implementar como state machine):
  - PENDING → CONFIRMED (cuando se crea PaymentIntent en Stripe)
  - PENDING → CANCELLED (timeout 30min, o cancelación manual)
  - CONFIRMED → PAID (cuando llega webhook payment_intent.succeeded)
  - CONFIRMED → CANCELLED (cancelación manual, cancelar PaymentIntent sin cobro)
  - PAID → REMINDED (cuando job envía recordatorio 24h antes)
  - PAID → CANCELLED (cancelación con refund: 100% si ≥24h, 50% si <24h)
  - PAID → COMPLETED (caso edge: si reminder falló, admin puede marcar directo)
  - REMINDED → COMPLETED (admin/doctor marca post-consulta)
  - REMINDED → CANCELLED (cancelación con refund 50%, penalización)
  - REMINDED → NO_SHOW (cron automático: 1h después de dateTime sin COMPLETED)
  - COMPLETED, CANCELLED y NO_SHOW son estados finales

  Si alguien intenta una transición inválida → AppError con código INVALID_STATE_TRANSITION

Cada cambio de estado:
  - Actualiza appointment.status + timestamp correspondiente
  - Crea un AppointmentEvent
  - Log estructurado con { appointmentId, from, to, trigger }

Cancelación:
  - Si status es PENDING → cancelar sin refund (no se cobró)
  - Si status es CONFIRMED → cancelar PaymentIntent en Stripe (sin cobro), sin refund
  - Si status es PAID o REMINDED:
    - Si dateTime - now ≥ 24h → refund completo (100%)
    - Si dateTime - now < 24h → refund parcial (50%), penalización
  - COMPLETED, NO_SHOW → no cancelable, retornar INVALID_STATE_TRANSITION
  - Registrar motivo de cancelación y quién canceló (paciente vs admin)

Implementa la state machine como un módulo separado:
  src/modules/appointments/state-machine.ts
  - Mapa de transiciones válidas
  - Función: canTransition(from, to): boolean
  - Función: transition(appointmentId, to, metadata): Promise<Appointment>

Tests:
  - Creación exitosa de cita con PaymentIntent (mock Stripe)
  - Transiciones válidas e inválidas del state machine
  - Cancelación con refund y sin refund
  - Conflicto de slot (dos pacientes misma hora)
  - TTL de cita pendiente
```

---

## Fase 6 — Webhooks de Stripe (Idempotencia)

**Duración**: 2–3 días

### Prompt para Claude Code:

```
Implementa el handler de webhooks de Stripe con idempotencia garantizada.

Ruta: POST /api/webhooks/stripe

Flujo del webhook handler:
  1. Verificar firma con stripe.webhooks.constructEvent (raw body + secret)
  2. Extraer stripeEventId del evento
  3. IDEMPOTENCIA: Verificar en tabla WebhookEvent si ya se procesó
     - Si existe con processedAt != null → retornar 200 inmediatamente (ya procesado)
     - Si no existe → insertar con processedAt = null (claim el evento)
     - Usar transacción con lock: INSERT ... ON CONFLICT DO NOTHING + verificar affected rows
  4. Procesar según event.type:
     - payment_intent.succeeded:
       a. Buscar appointment por stripePaymentIntentId
       b. Transicionar a CONFIRMED (via state machine)
       c. Encolar job de email de confirmación
       d. Encolar job de recordatorio programado (24h antes de la cita)
     - payment_intent.payment_failed:
       a. Registrar evento en AppointmentEvent
       b. NO cambiar estado (el paciente puede reintentar)
       c. Encolar notificación de fallo de pago
     - charge.refunded:
       a. Registrar evento
       b. Log para auditoría
  5. Marcar WebhookEvent.processedAt = now()
  6. Siempre retornar 200 (Stripe reintenta si recibe 4xx/5xx)

Para la idempotencia, crea src/lib/idempotency.ts:
  - withIdempotency(key: string, fn: () => Promise<T>): Promise<T>
  - Usa la tabla IdempotencyRecord
  - Si la key existe y tiene response → retorna el response guardado
  - Si no → ejecuta fn, guarda response, retorna
  - TTL de 24h en los records

IMPORTANTE sobre el raw body en Fastify:
  - Stripe necesita el body raw para verificar firma
  - Configura Fastify con: addContentTypeParser para 'application/json' que guarde rawBody
  - O usa fastify-raw-body plugin

Tests (CRÍTICOS - el challenge exige demostrar idempotencia):
  1. test: webhook llega 1 vez → cita pasa a CONFIRMED, email encolado
  2. test: MISMO webhook llega 2 veces → cita sigue CONFIRMED, email se envía solo 1 vez
  3. test: webhook con firma inválida → 401
  4. test: webhook para cita inexistente → log warning, 200 (no reventar)
  5. test: payment_failed → estado no cambia, evento registrado
  6. test: webhook llega pero DB está en estado inesperado → log error, no crash
```

---

## Fase 7 — Sistema de Colas (BullMQ)

**Duración**: 2–3 días

### Prompt para Claude Code:

```
Implementa el sistema de colas con BullMQ para jobs asíncronos.

Colas a crear:
  1. email-notifications: envío de emails
  2. appointment-reminders: recordatorios 24h antes
  3. appointment-expiration: TTL de citas pendientes
  4. appointment-noshow: cron cada 15min para marcar no-shows
  5. dead-letter: jobs que agotan reintentos

Estructura en src/queues/:
  - queues.ts: definición e inicialización de todas las colas
  - workers/
    - email.worker.ts
    - reminder.worker.ts
    - expiration.worker.ts
  - jobs/
    - email.job.ts (tipos y factory)
    - reminder.job.ts
    - expiration.job.ts

Estrategia de Retry para CADA cola:

email-notifications:
  - attempts: 3
  - backoff: exponential, delay inicial 5000ms (5s, 25s, 125s)
  - Al agotar reintentos: mover a dead-letter, actualizar AppointmentEvent con EMAIL_FAILED
  - NO lanzar error que tire la app

appointment-reminders:
  - Es un job DELAYED: se encola con delay calculado (dateTime - 24h - now)
  - attempts: 3
  - backoff: exponential, delay inicial 10000ms
  - Al agotar: dead-letter + marcar notification_failed + alerta a admin

appointment-expiration:
  - Se encola al crear cita PENDING con delay de 30 minutos
  - attempts: 1 (no tiene sentido reintentar una expiración)
  - Verifica estado actual: si ya no es PENDING, ignorar (idempotente)

appointment-noshow:
  - Repeatable job (cron): corre cada 15 minutos
  - Busca citas en estado REMINDED donde dateTime + 1h < now
  - Transiciona cada una a NO_SHOW via state machine
  - Idempotente: si ya es NO_SHOW o COMPLETED, ignorar
  - attempts: 1
  - Log de cada cita marcada

Dead Letter Queue:
  - Worker que solo registra en logs + Sentry
  - Expone endpoint admin: GET /api/admin/dead-letter → ver jobs fallidos

Cada worker debe:
  - Tener su propio logger child con { queue: 'nombre', jobId }
  - Propagar requestId si existe en job.data
  - Hacer try/catch granular (no genérico)
  - Registrar AppointmentEvent en cada operación

Para los emails, crea el servicio de Resend:
  src/modules/notifications/email.service.ts
  - sendConfirmationEmail(appointment, patient)
  - sendReminderEmail(appointment, patient)
  - sendCancellationEmail(appointment, patient)
  - sendPaymentFailedEmail(appointment, patient)
  - Cada uno usa un template HTML simple (inline, no archivos .hbs)
  - En desarrollo: log el contenido del email en vez de enviarlo

Tests:
  - Job de email ejecuta y marca como enviado
  - Job de email falla 3 veces → mueve a dead-letter → AppointmentEvent EMAIL_FAILED
  - Job de reminder se ejecuta al tiempo correcto (simular con advanceTimersByTime)
  - Job de expiración cancela cita PENDING pero ignora cita ya CONFIRMED
  - Retry con backoff exponencial (verificar delays)
```

---

## Fase 8 — Panel Administrativo (API + Frontend básico)

**Duración**: 3–4 días

### Prompt para Claude Code (API Admin):

```
Implementa las rutas del panel administrativo.

Autenticación admin:
  - Simple: API key en header x-admin-key (desde env var)
  - Middleware que verifica la key antes de cada ruta /api/admin/*

Rutas admin:

GET  /api/admin/appointments
  - Filtros: status, doctorId, patientId, dateFrom, dateTo
  - Paginación cursor-based
  - Incluir: patient name, doctor name
  - Ordenar por dateTime desc

GET  /api/admin/appointments/:id
  - Appointment completo con TODOS los AppointmentEvents ordenados cronológicamente
  - Incluir: datos del paciente, datos del doctor, info de pago de Stripe

PATCH /api/admin/appointments/:id/cancel
  - Cancelar con motivo (body: { reason: string })
  - Ejecuta refund si aplica
  - Registra evento CANCELLED con metadata { cancelledBy: 'admin', reason }

PATCH /api/admin/appointments/:id/complete
  - Solo si status permite la transición
  - Registra evento

PATCH /api/admin/appointments/:id/no-show
  - Marca como no-show
  - Registra evento

GET  /api/admin/dashboard
  - Stats: citas hoy, citas esta semana, por status
  - Ingresos del día/semana/mes (sumar PaymentIntents exitosos)
  - Tasa de no-show por doctor

GET  /api/admin/events
  - Timeline global de eventos recientes (últimas 24h)
  - Útil para debugging

GET  /api/admin/dead-letter
  - Jobs en dead letter queue con sus datos y error

Tests:
  - Acceso sin API key → 401
  - Listado con filtros
  - Cancelación desde admin con refund
  - Dashboard devuelve stats correctos
```

### Prompt para Claude Code (Frontend Admin):

```
Crea el frontend del panel admin siguiendo estrictamente el sistema de diseño
definido en CLAUDE.md sección "Frontend — Panel Admin".

Stack: React + Vite + Tailwind CSS
Fuente: Inter (importar desde Google Fonts)
Paleta: blanco, azul (#2563EB), negro (#0F172A) como colores dominantes.
Estilo: limpio, clínico, profesional. Sin decoración innecesaria.

Layout:
  - Sidebar oscuro (bg-slate-900) fijo a la izquierda, 240px
    - Logo: "Clínica" en text-lg semibold blanco
    - Navegación: Dashboard, Citas, Dead Letter
    - Ítem activo: borde izquierdo azul + fondo azul translúcido
  - Área principal con fondo #F7F9FC
  - Header por página con título (text-xl bold) y acciones

Páginas:

1. Dashboard (/admin)
   - 4 StatsCards en grid: Citas hoy, Esta semana, Ingresos del mes, Tasa no-show
   - Cards blancas con borde sutil, número grande negro, label pequeño gris
   - Sin iconos decorativos en las cards — solo datos

2. Citas (/admin/appointments)
   - Barra de filtros: select de status, doctor, rango de fechas. Fondo blanco,
     bordes grises, todo en una línea
   - DataTable limpia:
     - Header con fondo #F7F9FC
     - Columnas: Paciente, Doctor, Fecha/hora, Status (badge), Acciones
     - Hover de fila en azul-100
     - Bordes solo horizontales, color #CBD5E1
     - Paginación cursor-based abajo a la derecha
   - StatusBadge como pill: fondo suave del color del status, texto del tono 700
   - Click en fila → ir al detalle

3. Detalle de cita (/admin/appointments/:id)
   - Card superior: datos del paciente, doctor, fecha, status actual (badge grande)
   - Botones de acción según estado:
     - PAID/REMINDED → "Cancelar cita" (botón peligro con borde rojo, requiere modal
       de confirmación que muestra monto de refund)
     - PAID/REMINDED → "Marcar completada" (botón primario azul)
     - REMINDED → "Marcar no-show" (botón secundario)
   - EventTimeline debajo:
     - Línea vertical azul a la izquierda
     - Cada evento: punto en la línea + timestamp (text-xs gris) + descripción (text-sm negro)
     - Más reciente arriba
     - Sin cards individuales por evento — mantener minimalista

4. Dead Letter (/admin/dead-letter)
   - Tabla simple: Job ID, Cola, Error, Fecha, Datos
   - Filas con fondo rojo-50 sutil para indicar fallo
   - Click expande los datos completos del job (JSON formateado)

Componentes compartidos:
  - StatusBadge (recibe status, retorna pill con colores del CLAUDE.md)
  - StatsCard (número + label, borde sutil)
  - DataTable (header, body, hover, paginación)
  - EventTimeline (línea vertical + eventos)
  - ConfirmModal (fondo overlay, card blanca centrada, texto de confirmación,
    dos botones: cancelar secundario + confirmar primario/peligro)
  - Toast (notificación temporal arriba derecha, borde izquierdo de color según tipo)

Reglas visuales:
  - Espaciado en múltiplos de 4px
  - Border radius: 6px botones, 8px cards, 12px modales
  - Sombras solo en modales y dropdowns (shadow-sm)
  - Sin gradientes, sin patrones, sin ilustraciones
  - Empty states con texto directo, sin SVGs decorativos
  - Loading: skeletons en tono #F7F9FC, sin spinners coloridos
  - Texto de interfaz en español
  - Responsive: sidebar colapsa a hamburger en mobile

El admin key se pide al entrar en un modal centrado (input + botón azul)
y se guarda en memoria (no localStorage). Si la key es incorrecta, toast
de error rojo.

Usa fetch directo para las llamadas a la API. No axios.
```

---

## Fase 9 — Documentación y ADRs

**Duración**: 1–2 días

### Prompt para Claude Code:

```
Genera la documentación requerida del proyecto.
Todos los documentos se guardan en la carpeta docs/ excepto SPEC.md y README.md que van en la raíz.

1. SPEC.md (raíz del proyecto) - Actualizar con:
   - Diagrama de estados (Mermaid syntax) — NOTA: yo ya escribí el diagrama,
     conviértelo a Mermaid manteniendo las mismas transiciones
   - Matriz de errores completa (la que yo escribí + las que descubrimos implementando)
   - Diagrama de secuencia del flujo completo: reserva → pago → confirmación → reminder
   - Descripción de cada endpoint

2. docs/ADR-001-idempotency.md:
   - Contexto: webhooks de Stripe pueden llegar duplicados
   - Decisión: tabla WebhookEvent con stripeEventId unique + INSERT ON CONFLICT
   - Alternativas consideradas: Redis lock, hash del payload
   - Consecuencias: requiere limpieza periódica de la tabla
   - Status: Accepted

3. docs/ADR-002-retry-strategy.md:
   - Contexto: emails y jobs pueden fallar
   - Decisión: backoff exponencial por cola, dead letter para jobs agotados
   - Config por cola: email (3 attempts, 5s base), reminder (3, 10s), expiration (1)
   - Alternativas: retry lineal, circuit breaker
   - Consecuencias: dead letter queue requiere monitoreo
   - Status: Accepted

4. docs/RUNBOOK.md:
   - Qué hacer si Redis se cae
   - Qué hacer si Stripe no responde
   - Qué hacer si hay muchos jobs en dead letter
   - Qué hacer si un paciente reporta que no recibió email
   - Qué hacer si hay citas PENDING atascadas
   - Cómo reprocessar un webhook manualmente
   - Cómo verificar el estado de las colas

5. README.md (raíz del proyecto) actualizado:
   - Setup completo (docker, env vars, migrate, seed)
   - Cómo correr tests
   - Cómo probar el flujo con Stripe CLI
   - Arquitectura del proyecto (descripción breve de cada módulo)
```

---

## Fase 10 — CI/CD y Testing E2E

**Duración**: 1–2 días

### Prompt para Claude Code:

```
Configura CI completo y tests de integración end-to-end.

GitHub Actions (.github/workflows/ci.yml):
  - Trigger: push a main y PRs
  - Services: PostgreSQL y Redis en containers
  - Steps:
    1. Checkout
    2. Install deps (con cache de node_modules)
    3. Lint (ESLint + Prettier check)
    4. Type check (tsc --noEmit)
    5. Migrate DB test
    6. Run unit tests
    7. Run integration tests
    8. Coverage report (mínimo 80%)

Tests de integración end-to-end (src/tests/e2e/):

test: "flujo completo happy path"
  1. Crear paciente → verificar Stripe customer creado
  2. Crear doctor con disponibilidad
  3. Obtener slots disponibles
  4. Crear cita → verificar PaymentIntent creado, status PENDING
  5. Simular webhook payment_intent.succeeded → verificar CONFIRMED
  6. Verificar email de confirmación encolado
  7. Avanzar tiempo → verificar reminder enviado
  8. Marcar como completada → verificar estado final

test: "idempotencia de webhooks"
  1. Crear cita y simular pago
  2. Enviar mismo webhook 3 veces
  3. Verificar: solo 1 transición, solo 1 email, 3 WebhookEvents pero 1 procesado

test: "cancelación con refund"
  1. Crear y pagar cita
  2. Cancelar → verificar refund en Stripe mock
  3. Verificar estado CANCELLED y eventos

test: "expiración de cita no pagada"
  1. Crear cita (PENDING)
  2. Avanzar 31 minutos
  3. Verificar estado CANCELLED por expiración

test: "email falla y se reintenta"
  1. Mock email service para fallar 2 veces y éxito la 3ra
  2. Verificar 3 intentos, resultado exitoso, eventos registrados

test: "email falla definitivamente"
  1. Mock email service para fallar siempre
  2. Verificar 3 intentos, job en dead letter, AppointmentEvent EMAIL_FAILED

Para los mocks de Stripe:
  - Crear un helper que genera eventos de webhook firmados
  - Mock del SDK de Stripe para PaymentIntent y Refund

Para simular tiempo:
  - Usar vi.useFakeTimers() de Vitest para jobs delayed
```

---

## Fase 11 — Stretch Goals (Opcional)

### 11.1 Google Calendar

```
Agrega integración con Google Calendar.

Cuando una cita pasa a CONFIRMED:
  - Crear evento en el Google Calendar del paciente
  - Requiere OAuth2 flow para que el paciente autorice

Cuando se cancela:
  - Eliminar el evento del calendario

Usa googleapis SDK.
Crea un módulo src/modules/calendar/ con el service.
Es opcional: si el paciente no conectó su Google, el sistema funciona igual.
```

### 11.2 WhatsApp (Twilio)

```
Agrega notificaciones por WhatsApp como canal alternativo al email.

Usa Twilio API para WhatsApp Business.
El paciente puede elegir su canal preferido (email, whatsapp, ambos).
Misma estrategia de retry que emails.
Nuevo worker: whatsapp.worker.ts
```

### 11.3 Dashboard de Métricas

```
Agrega al panel admin un dashboard con gráficas:
- No-shows por doctor (bar chart)
- Ingresos por día del último mes (line chart)
- Distribución de citas por status (pie chart)
- Citas por hora del día (heatmap)
- Tasa de cancelación semanal

Usa Recharts en el frontend.
Los datos vienen de un endpoint: GET /api/admin/metrics?period=30d
```

---

## Orden de Ejecución Recomendado

| Semana | Fases | Foco |
|---|---|---|
| 1 | 0, 1, 2 | Diseño propio + scaffold + DB |
| 2 | 3, 4 | Infra (logger, Sentry, Redis) + CRUDs base |
| 3 | 5, 6 | Core de citas + webhooks idempotentes |
| 4 | 7, 8 | Colas + panel admin |
| 5 | 9, 10 | Docs + CI + tests E2E |
| 6 | 11 | Stretch goals |

---

## Tips para Claude Code

**Siempre haz esto antes de aceptar código:**

1. **Webhooks**: pregunta "¿por qué esto es idempotente?" — si no puedes responder, no lo aceptes
2. **Error handling**: rechaza cualquier `catch (e) { console.log(e) }` — exige AppError, logging estructurado, y Sentry
3. **State machine**: verifica que CADA transición pase por la state machine, nunca un `update({ status })` directo
4. **Tests**: cada feature debe venir con tests, no después
5. **Logs**: verifica que requestId se propaga en cada log

**Patrón de trabajo con Claude Code:**

```
1. Pega el prompt de la fase
2. Revisa el código generado
3. Corre los tests
4. Si algo no tiene sentido, pregunta "¿por qué hiciste X en vez de Y?"
5. Itera hasta que entiendas cada línea
```
