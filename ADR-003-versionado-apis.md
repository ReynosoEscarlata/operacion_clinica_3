# ADR-003 — Versionado de APIs: cambios aditivos, deprecación, /v1 → /v2

**Estado:** Aceptado
**Fecha:** 2026-06-20
**Contexto del RFC:** [RFC-001-bounded-contexts.md](./RFC-001-bounded-contexts.md)

## Contexto

Con 5 servicios desplegándose de forma independiente (regla del plan: tocar
`services/notifications/**` no debe afectar a Appointments), los contratos públicos (OpenAPI,
esquemas de eventos, rutas del gateway) se vuelven el punto de coordinación entre equipos/PRs que
antes era implícito (mismo repo, mismo deploy). Sin una política de versionado explícita, un
cambio "inocente" en un contrato rompe a un consumidor en producción sin aviso.

## Decisión

### Versionado en URL

Todas las rutas HTTP llevan el prefijo de versión mayor: `/v1/appointments`, `/v1/auth/login`,
etc. (ya reflejado en los contratos de `packages/contracts/`). El número de versión vive en la
URL, no en un header — es más explícito en logs, capturas de pantalla de debugging y en la propia
definición de Swagger/Redoc.

### Cambios aditivos no requieren bump de versión

Se considera **aditivo** (no rompe el contrato, no requiere `/v2`):
- Agregar un campo opcional nuevo a un request o response.
- Agregar un endpoint nuevo.
- Agregar un valor nuevo a un enum **siempre que el consumidor lo trate como abierto** (ver regla
  de enums abajo).
- Agregar un evento nuevo, o un campo opcional nuevo a un evento existente.

Se considera **breaking** (requiere `/v2` del recurso afectado, no del servicio completo):
- Quitar o renombrar un campo.
- Cambiar el tipo de un campo existente.
- Volver requerido un campo que era opcional.
- Quitar un valor de un enum, o cambiar el significado de uno existente.
- Cambiar el código de status HTTP de una respuesta para el mismo escenario.

### Regla de enums (relevante para `AppointmentStatus`, `EventType`, etc.)

Los consumidores de un enum publicado en un contrato (ej. el gateway, Notifications consumiendo
`AppointmentStatusChanged`) deben tratar valores desconocidos como un caso `default` explícito
(log + no-op), nunca como error fatal. Esto permite agregar estados nuevos sin romper consumidores
viejos durante una migración gradual.

### Deprecación

1. La versión nueva (`/v2`) se publica y coexiste con `/v1` durante una ventana mínima de
   deprecación (a definir por servicio, recomendado ≥ 1 sprint para servicios internos).
2. `/v1` se marca `deprecated: true` en el OpenAPI spec (Swagger UI lo muestra) y responde header
   `Deprecation: true` + `Sunset: <fecha>`.
3. Solo se elimina `/v1` cuando no quedan consumidores activos conocidos (verificable por métricas
   RED por endpoint, Fase 4) o vence la ventana de deprecación, lo que pase después.
4. Eventos: un esquema de evento deprecado sigue publicándose en paralelo al nuevo (doble
   publicación temporal) hasta que todos los consumers migraron — no se "apaga" un esquema de
   evento sin confirmar que nadie lo consume.

### Contract tests como gate

Todo cambio a un contrato (OpenAPI o esquema de evento) debe pasar los contract tests definidos
en la Fase 4 (Schemathesis/validador runtime + Pact) antes de mergear. Esto es lo que convierte
esta política de "lo dice un documento" a "lo hace cumplir el CI".

## Opciones consideradas

**Opción A (elegida) — Versionado en URL + ventana de deprecación explícita.**
- Trade-offs: requiere mantener dos versiones en paralelo durante la transición (más código
  temporalmente), pero es el patrón más simple de entender para humanos (incluyendo quien revise
  el PR de SMS sin IA) y el más fácil de testear con contract tests por versión.

**Opción B (descartada) — Versionado por header (`Accept: application/vnd.clinica.v2+json`).**
- Se descarta para esta entrega: es más "correcto" desde REST puro, pero menos visible en logs y
  en debugging manual durante la demo, y agrega complejidad de negociación de contenido que no
  se justifica con 5 servicios internos (no es una API pública de terceros).

## Consecuencias

- Cada contrato en `packages/contracts/` declara su versión en el `info.version` del OpenAPI y en
  el prefijo de las rutas (`/v1/...`).
- El gateway enruta por prefijo de versión; agregar `/v2` de un servicio no requiere cambios en
  los demás servicios.
- Los esquemas de eventos versionan de forma independiente de las rutas HTTP (un evento puede
  llegar a `v2` sin que el servicio que lo consume haya migrado su API HTTP, y viceversa).
