# ADR-007: Compute (ECS Fargate vs. Lambda vs. híbrido)

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

Los 5 servicios (`auth`, `appointments`, `doctors`, `payments`, `notifications`) son hoy procesos
Node.js de larga vida: Fastify sirviendo HTTP, más — en el caso de `appointments` —
workers de BullMQ de larga vida (`appointment-expiration`, `appointment-reminders`,
`appointment-noshow`, este último con un job repetible/cron cada 15 min) y consumers de Redis
Streams con polling continuo (`event-consumer.ts`, `outbox-relay.ts` en Appointments/Doctors/
Payments). Migrar un consumer de streaming continuo a una función Lambda (que se factura por
invocación y tiene límite de duración) es fricción real, no gratuita.

## Opciones consideradas

1. **Todo en Lambda** — cada endpoint HTTP y cada worker como función independiente.
   - Pros: costo cero cuando no hay tráfico, sin servidores que gestionar.
   - Contras: los consumers de Redis Streams (`XREADGROUP` con polling) y el relay del Outbox
     (poll cada 2s) no encajan en el modelo de invocación de Lambda sin reescribirlos a un
     mecanismo distinto (ej. Lambda invocada por un scheduler cada N segundos, perdiendo la
     semántica de consumer group continuo); reescribir 5 servicios completos es la opción de
     mayor esfuerzo.
2. **Todo en ECS Fargate** — cada servicio como contenedor de larga vida, tal como corre hoy en
   Docker Compose.
   - Pros: cero reescritura de los servicios existentes — el `Dockerfile` de cada uno ya funciona;
     los consumers/relays siguen funcionando exactamente igual.
   - Contras: se paga por los contenedores corriendo 24/7 incluso en horarios de bajo tráfico
     (relevante para el presupuesto austero confirmado); jobs de baja frecuencia (ej. purga de
     retención de la Fase 5, aprovisionamiento de tenant de la Fase 8) no se benefician de correr
     en un contenedor siempre activo.
3. **Híbrido: Fargate para los 5 servicios HTTP + workers embebidos, Lambda para jobs programados
   y de bajo volumen** (aprovisionamiento de tenant, purga de retención, consumidores de baja
   frecuencia si se introducen a futuro).
   - Pros: cero reescritura de lo que ya funciona (los 5 servicios se portan tal cual a Fargate);
     Lambda se usa donde el modelo de invocación por evento realmente encaja (ej. un trigger de
     aprovisionamiento de tenant vía API Gateway, o un cron de EventBridge para retención).
   - Contras: dos modelos de compute a operar (dos pipelines de CI/CD, dos formas de logging/
     observabilidad) en vez de uno solo.

## Decisión

Elegimos la **Opción 3: híbrido** — Fargate para los 5 servicios existentes, Lambda para jobs
programados y de bajo volumen (aprovisionamiento de tenant de la Fase 8, purga de retención de la
Fase 5). Ratificada por Ricardo el 2026-07-29 sobre la inclinación de Fase 0.

## Consecuencias

- **Positivas:** ninguna reescritura de los 5 servicios existentes; el `Dockerfile` de cada uno
  (ya verificado con `docker build` real, según `SPEC.md`) es directamente la base de la task
  definition de Fargate.
- **Negativas / tradeoffs:** operar dos runtimes implica que la observabilidad (Fase 6) debe cubrir
  ambos por separado — las métricas RED que ya existen (`prom-client`, Fase 4 del Challenge 4) no
  aplican tal cual a Lambda (requeriría CloudWatch Metrics/EMF en vez de scraping de `/metrics`).
- **Cosas a monitorear:** costo real de Fargate corriendo 24/7 vs. el presupuesto austero — si el
  costo de mantener 5+ servicios (más réplicas por Multi-AZ) corriendo todo el tiempo excede el
  rango ~$150-300/mes a 10 clínicas, reconsiderar cuáles servicios pueden escalar a cero (Fargate
  soporta autoscaling a 0 tareas si el tráfico lo permite, pero rompe el supuesto de "siempre
  disponible" para un consumer de streaming).

## Referencias
- `docker-compose.yml` (los 5 servicios ya corren como contenedores de larga vida)
- `docs/cost/precios-aws-consultados.md` (precios de Fargate vs. Lambda)
