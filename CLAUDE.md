# CLAUDE.md — Clínica Scheduler

## Proyecto

Sistema de reserva de citas para una clínica médica con cobro online (Stripe), notificaciones por email, colas asíncronas y panel administrativo.

Documento de diseño: `SPEC.md` (diagrama de estados, matriz de errores, diagramas de secuencia).
Plan de fases: `docs/plan-clinica.md`.

## Stack

- Runtime: Node.js + TypeScript (strict mode)
- Framework: Fastify
- ORM: Prisma + PostgreSQL
- Colas: BullMQ + Redis (ioredis)
- Pagos: Stripe (test mode)
- Email: Resend
- Logging: Pino (JSON en prod, pretty en dev)
- Error tracking: Sentry
- Testing: Vitest + Supertest
- Lint: ESLint + Prettier

## Idioma

- Código (variables, funciones, clases, tipos, nombres de archivo): **inglés**
- Comentarios en código: **español**
- Mensajes de commit: **español**
- Documentación (README, ADRs, SPEC, runbooks): **español**
- Logs estructurados (campos de pino): **inglés** (para compatibilidad con herramientas)

## Convención de commits

Conventional Commits en español:

```
feat: agregar endpoint de cancelación con refund parcial
fix: corregir race condition en reserva de slots
chore: actualizar dependencias de Stripe SDK
test: agregar tests de idempotencia para webhooks
docs: documentar estrategia de retry en ADR-002
refactor: extraer state machine a módulo separado
```

## Estructura del proyecto

```
src/
  app.ts                        # Inicialización de Fastify, plugins, rutas
  server.ts                     # Entrypoint, arranque del servidor
  config/
    env.ts                      # Validación de variables de entorno con zod
    stripe.ts                   # Cliente de Stripe
    redis.ts                    # Conexión ioredis
    sentry.ts                   # Inicialización de Sentry
    email.ts                    # Cliente de Resend
  modules/
    appointments/
      appointments.routes.ts
      appointments.controller.ts
      appointments.service.ts
      appointments.repository.ts
      state-machine.ts          # Mapa de transiciones, canTransition(), transition()
    patients/
      patients.routes.ts
      patients.controller.ts
      patients.service.ts
      patients.repository.ts
    doctors/
      doctors.routes.ts
      doctors.controller.ts
      doctors.service.ts
      doctors.repository.ts
    payments/
      webhooks.handler.ts       # POST /api/webhooks/stripe
      payments.service.ts
    notifications/
      email.service.ts
      templates/                # Funciones que retornan HTML strings
  queues/
    queues.ts                   # Definición e init de todas las colas
    workers/
      email.worker.ts
      reminder.worker.ts
      expiration.worker.ts
      noshow.worker.ts
    jobs/
      email.job.ts
      reminder.job.ts
      expiration.job.ts
      noshow.job.ts
  middleware/
    request-id.ts
    error-handler.ts
    admin-auth.ts
  lib/
    logger.ts                   # Pino con requestId
    idempotency.ts              # withIdempotency()
    app-error.ts                # Clase AppError
    constants.ts
  prisma/
    schema.prisma
    seed.ts
tests/
  unit/
  integration/
  e2e/
  helpers/                      # Factories, mocks de Stripe, utils de test
```

## Estilo de código

### Patrón general: servicios como clases, utilidades funcionales

```typescript
// ✅ Services: clases con dependencias inyectadas
export class AppointmentService {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly stripeClient: Stripe,
    private readonly emailQueue: Queue,
    private readonly logger: Logger
  ) {}

  async create(dto: CreateAppointmentDto): Promise<Appointment> {
    // ...
  }
}

// ✅ Utilidades: funciones puras
export const canTransition = (from: AppointmentStatus, to: AppointmentStatus): boolean => {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
};

// ✅ Factories para instanciar services con dependencias
export const buildAppointmentService = (deps: Dependencies): AppointmentService => {
  return new AppointmentService(deps.appointmentRepo, deps.stripe, deps.emailQueue, deps.logger);
};
```

### Reglas de TypeScript

- `strict: true` en tsconfig, sin excepciones
- No usar `any`. Usar `unknown` si el tipo no se conoce, luego narrowing
- Interfaces para contratos públicos, types para uniones/utilidades
- Enums solo los de Prisma. En código propio, usar `as const` con tipo derivado
- Retornos explícitos en funciones públicas de services

### Nombres

- Archivos: `kebab-case` con sufijo de rol → `appointments.service.ts`, `email.worker.ts`
- Clases: `PascalCase` → `AppointmentService`, `EmailWorker`
- Funciones/variables: `camelCase` → `canTransition`, `requestId`
- Constantes: `UPPER_SNAKE_CASE` → `MAX_RETRY_ATTEMPTS`, `VALID_TRANSITIONS`
- Tipos/interfaces: `PascalCase` → `CreateAppointmentDto`, `AppointmentWithEvents`

## Arquitectura por capas

```
Route → Controller → Service → Repository → Prisma
```

- **Route**: define ruta, método HTTP, schema de validación (Typebox), llama al controller
- **Controller**: extrae params/body/query del request, llama al service, formatea response. No tiene lógica de negocio
- **Service**: toda la lógica de negocio. Recibe DTOs tipados, retorna entidades. Aquí vive la orquestación (crear en DB + crear PaymentIntent + encolar job)
- **Repository**: queries Prisma. Abstracción sobre la DB. Transacciones aquí

No saltar capas: un controller nunca llama a Prisma directamente.

## State Machine de Citas

Referencia completa: `SPEC.md` sección 1.

Regla absoluta: **todo cambio de estado pasa por la state machine**. Nunca hacer `prisma.appointment.update({ status })` directo.

```typescript
// ✅ Correcto
await stateMachine.transition(appointmentId, AppointmentStatus.PAID, { trigger: 'webhook' });

// ❌ Prohibido
await prisma.appointment.update({ where: { id }, data: { status: 'PAID' } });
```

La función `transition()` debe:
1. Verificar `canTransition(currentStatus, newStatus)`
2. Actualizar status + timestamp correspondiente en una transacción
3. Crear `AppointmentEvent` con tipo `STATUS_CHANGED`
4. Loguear con `{ appointmentId, from, to, trigger }`

## Manejo de errores

### Clase AppError

```typescript
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,         // Ej: 'INVALID_STATE_TRANSITION', 'SLOT_UNAVAILABLE'
    message: string,
    public readonly isOperational = true   // true = error esperado, false = bug
  ) {
    super(message);
  }
}
```

### Reglas estrictas

```typescript
// ❌ PROHIBIDO — nunca generar código así
catch (error) {
  console.log(error);
}

// ❌ PROHIBIDO — catch vacío
catch {}

// ❌ PROHIBIDO — error genérico sin contexto
catch (error) {
  throw new Error('Something went wrong');
}

// ✅ CORRECTO — error con contexto, logging estructurado, Sentry
catch (error) {
  logger.error({ err: error, appointmentId, operation: 'createPaymentIntent' },
    'Error al crear PaymentIntent en Stripe'
  );
  Sentry.captureException(error, { extra: { appointmentId } });

  if (error instanceof Stripe.errors.StripeAPIError) {
    throw new AppError(502, 'STRIPE_UNAVAILABLE', 'Servicio de pago no disponible');
  }
  throw error; // Re-lanzar errores no esperados
}
```

### Error handler global (middleware)

- `AppError` con `isOperational: true` → responder con `{ error: { code, message } }` y el statusCode
- `AppError` con `isOperational: false` → log + Sentry + responder 500 genérico
- Error no-AppError → log + Sentry + responder 500 genérico
- Nunca exponer stack traces en producción
- Siempre incluir `requestId` en la respuesta de error

## Logging

Usar Pino. Cada log debe tener contexto suficiente para debuggear sin reproducir.

```typescript
// ✅ Log estructurado con contexto
logger.info({ appointmentId, patientId, status: 'CONFIRMED', trigger: 'webhook' },
  'Cita confirmada tras pago exitoso'
);

// ❌ Log sin contexto
logger.info('Cita confirmada');
```

### requestId

- Se genera en middleware como `uuid v4`
- Se inyecta en el request context de Fastify
- Se propaga a todos los logs del request
- Se incluye en jobs de BullMQ (`job.data.requestId`)
- Los workers crean un `logger.child({ requestId: job.data.requestId, queue: 'nombre' })`
- Se retorna al cliente en header `x-request-id`

## Idempotencia

### Webhooks de Stripe

```typescript
// Patrón obligatorio — tabla WebhookEvent
async function handleWebhook(stripeEventId: string, handler: () => Promise<void>): Promise<void> {
  // 1. INSERT ... ON CONFLICT DO NOTHING
  // 2. Si no insertó (ya existía) → return (ya procesado)
  // 3. Ejecutar handler
  // 4. Marcar processedAt = now()
}
```

Nunca aceptar código de webhooks sin verificar que implementa este patrón.

### Jobs de BullMQ

Todo worker verifica el estado actual antes de operar:

```typescript
// ✅ Idempotente — verifica estado antes de actuar
const appointment = await repository.findById(jobData.appointmentId);
if (appointment.status !== AppointmentStatus.PENDING) {
  logger.info({ appointmentId, currentStatus: appointment.status },
    'Job de expiración ignorado: cita ya no está pendiente'
  );
  return; // No-op, no error
}
```

## Colas y Retry

### Estrategia por cola

| Cola | Intentos | Backoff | Base delay | Dead letter |
|------|----------|---------|------------|-------------|
| email-notifications | 3 | exponencial | 5000ms | Sí |
| appointment-reminders | 3 | exponencial | 10000ms | Sí |
| appointment-expiration | 1 | ninguno | — | No |
| appointment-noshow | 1 | ninguno | — | No |

### Dead letter queue

Jobs que agotan reintentos van a dead-letter. El worker de dead-letter:
1. Registra `AppointmentEvent` según el tipo de job (ej: `EMAIL_FAILED`)
2. Log error con todos los datos del job
3. Reporta a Sentry
4. NO lanza error ni tira la aplicación

## Testing

### Estructura

```
tests/
  unit/           # State machine, utilidades, validaciones (sin DB ni Redis)
  integration/    # Services con DB real (test containers o DB de test)
  e2e/            # Flujos completos: HTTP request → DB → queue → side effects
  helpers/
    factories.ts  # createTestPatient(), createTestAppointment()
    stripe.ts     # Mock de Stripe SDK, generador de webhooks firmados
    setup.ts      # beforeAll/afterAll para DB y Redis
```

### Reglas

- Todo feature nuevo incluye tests en el mismo PR. No se acepta código sin tests
- Mocks solo para servicios externos (Stripe, Resend, Sentry). DB y Redis usan instancias reales de test
- Tests de idempotencia son obligatorios para webhooks y workers
- Nombrar tests en español, descriptivos:

```typescript
describe('AppointmentService.cancel', () => {
  it('cancela cita PAID con refund completo si faltan más de 24h', async () => { ... });
  it('cancela cita PAID con refund 50% si faltan menos de 24h', async () => { ... });
  it('rechaza cancelación de cita COMPLETED con INVALID_STATE_TRANSITION', async () => { ... });
  it('es idempotente: cancelar cita ya cancelada retorna éxito sin error', async () => { ... });
});
```

### Coverage

Mínimo 80% global. Módulos críticos (state-machine, webhooks, idempotency) al 95%.

## Frontend — Panel Admin

### Dirección visual

Estética clínica: limpia, funcional, sin ruido. Predominan blanco, azul y negro.
El diseño transmite confianza y profesionalismo médico. Nada se siente "tech startup".
Simple no significa vacío — cada elemento tiene propósito y respira.

### Paleta de colores

```
--color-white:        #FFFFFF     ← fondo principal
--color-ice:          #F7F9FC     ← fondo de secciones alternas, cards, tablas zebra
--color-blue-100:     #E8F0FE     ← hover suave, badges informativos, selección activa
--color-blue-500:     #2563EB     ← acciones primarias, links, íconos activos
--color-blue-700:     #1D4ED8     ← hover de botones primarios
--color-black-900:    #0F172A     ← texto principal, headings
--color-black-600:    #475569     ← texto secundario, labels, metadata
--color-black-300:    #CBD5E1     ← bordes, divisores, inputs inactivos

--color-success:      #16A34A     ← status COMPLETED, confirmaciones
--color-warning:      #D97706     ← status REMINDED, alertas
--color-danger:       #DC2626     ← status CANCELLED, errores, botón destructivo
--color-muted:        #94A3B8     ← status NO_SHOW, elementos deshabilitados
```

### Tipografía

```
--font-display:  'Inter', sans-serif    ← headings, stats grandes, navegación
--font-body:     'Inter', sans-serif    ← texto general, tablas, formularios

Escala:
  text-xs:    0.75rem / 1rem       ← badges, timestamps
  text-sm:    0.875rem / 1.25rem   ← labels, metadata, tabla body
  text-base:  1rem / 1.5rem        ← texto general
  text-lg:    1.125rem / 1.75rem   ← subtítulos de sección
  text-xl:    1.25rem / 1.75rem    ← títulos de página
  text-3xl:   1.875rem / 2.25rem   ← números grandes en stats cards

Peso:
  400 (regular)  → cuerpo de texto, datos de tabla
  500 (medium)   → labels, navegación, botones
  600 (semibold) → subtítulos, stats
  700 (bold)     → solo headings principales
```

### Componentes clave

**StatusBadge** — Pill redondeado, fondo suave, texto del color del status:
```
PENDING    → fondo blue-100, texto blue-500
CONFIRMED  → fondo blue-100, texto blue-700
PAID       → fondo green-50, texto green-700
REMINDED   → fondo amber-50, texto amber-700
COMPLETED  → fondo green-50, texto green-700, checkmark
CANCELLED  → fondo red-50,   texto red-700
NO_SHOW    → fondo slate-100, texto slate-500
```

**StatsCard** — Card blanca con borde sutil (`border: 1px solid var(--color-black-300)`). Número grande (text-3xl, semibold, black-900) arriba, label pequeño (text-sm, black-600) abajo. Sin iconos decorativos innecesarios.

**DataTable** — Fondo blanco, header con fondo ice, filas con hover blue-100. Bordes solo horizontales (color-black-300). Texto de tabla en text-sm. Sin bordes exteriores redondeados excesivos (border-radius: 8px máximo).

**EventTimeline** — Línea vertical azul-500 a la izquierda. Cada evento es un punto en la línea con timestamp (text-xs, black-600) y descripción (text-sm, black-900). Sin cards individuales por evento — mantener minimalista.

**Botones**:
```
Primario   → fondo blue-500, texto white, hover blue-700, border-radius 6px
Secundario → fondo white, borde black-300, texto black-900, hover ice
Peligro    → fondo white, borde danger, texto danger, hover red-50
           → solo para cancelar citas, con confirmación modal
```

**Sidebar** — Fondo black-900, texto white, ítem activo con fondo blue-500/20 y borde izquierdo blue-500. Ancho fijo 240px. Logo/nombre de la clínica arriba en text-lg semibold.

### Reglas de diseño

- Espaciado consistente: múltiplos de 4px (4, 8, 12, 16, 24, 32, 48)
- Border radius: 6px para botones e inputs, 8px para cards, 12px para modales
- Sombras mínimas: solo en modales y dropdowns (`shadow-sm` de Tailwind)
- Sin gradientes. Sin fondos con patrones. Sin ilustraciones decorativas
- Máximo 2 niveles de profundidad visual (fondo ice → card blanca)
- Tablas sin scroll horizontal en desktop — priorizar columnas esenciales
- Empty states con texto directo: "No hay citas para estos filtros" — sin ilustraciones
- Loading states con skeleton en tono ice, sin spinners coloridos
- Responsive: sidebar colapsa en mobile a hamburger menu

### Copy de interfaz

- Texto en español
- Verbos directos en botones: "Cancelar cita", "Marcar completada", "Ver detalle"
- Confirmaciones destructivas: "¿Cancelar esta cita? Se emitirá un refund de $X al paciente"
- Errores específicos: "No se pudo cancelar: la cita ya fue completada" — no "Algo salió mal"
- Timestamps en formato legible: "hace 2 horas", "15 jun 2025, 10:30"

## Qué NO hacer

- **No generar el diagrama de estados** — ya está en SPEC.md, diseñado por el desarrollador
- **No usar `console.log`** — siempre Pino
- **No hacer `catch (e) { console.log(e) }`** — usar AppError + logger + Sentry
- **No cambiar status de cita sin state machine** — siempre `transition()`
- **No aceptar webhooks sin idempotencia** — siempre verificar WebhookEvent
- **No crear código sin tests** — test primero o junto con el feature
- **No usar `any`** — usar `unknown` y narrowing
- **No hardcodear configuración** — todo en env vars validadas con zod
- **No hacer retry genérico** — cada cola tiene su estrategia definida
- **No tragarse errores silenciosamente** — si falla, log + Sentry + respuesta apropiada

## Antes de cada PR

1. `make lint` pasa sin warnings
2. `make test` pasa al 100%
3. Tipos: `npx tsc --noEmit` sin errores
4. Cada cambio de estado tiene su `AppointmentEvent` registrado
5. requestId se propaga en todos los logs del flujo
6. Si toca webhooks: test de idempotencia incluido
7. Si toca colas: estrategia de retry configurada según la tabla
8. Commit message sigue Conventional Commits en español

## Referencias

- `SPEC.md` — Diagrama de estados, matriz de errores, diagramas de secuencia
- `docs/plan-clinica.md` — Plan de desarrollo por fases con prompts para Claude Code
- `docs/ADR-001-idempotency.md` — Estrategia de idempotencia (se crea en Fase 9)
- `docs/ADR-002-retry-strategy.md` — Estrategia de retry (se crea en Fase 9)
- `docs/RUNBOOK.md` — Procedimientos de respuesta a fallos (se crea en Fase 9)
