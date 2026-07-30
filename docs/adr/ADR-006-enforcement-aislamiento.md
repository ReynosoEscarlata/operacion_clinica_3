# ADR-006: Enforcement de aislamiento entre tenants

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

Independientemente de qué modelo de tenancy se elija en ADR-005, hace falta decidir **cuántas
capas de defensa** se implementan para evitar que un bug de código cruce datos entre clínicas. El
`event-consumer.ts` de este mismo repo ya tuvo un bug real donde el reintento "nunca funcionaba"
(documentado en `SPEC.md`, 2026-06-21) — la lección de ese incidente es que confiar en que el
código de aplicación "simplemente no tenga bugs" no es una estrategia.

## Opciones consideradas

1. **Solo capa de aplicación** (middleware + repositorio base, sin RLS) — más simple de
   implementar hoy.
   - Pros: no requiere tocar Postgres ni roles de DB; iteración más rápida.
   - Contras: un bug en el ORM, un query manual (`$queryRaw` de Prisma), o un desarrollador que
     olvida heredar del repositorio base, cruza tenants sin que nada lo detenga.
2. **RLS como única capa** (sin middleware/repositorio disciplinado) — delega todo a Postgres.
   - Pros: fuerte a nivel de motor.
   - Contras: sin `AsyncLocalStorage` + middleware, no hay forma limpia de poblar
     `current_setting('app.current_tenant')` por request; y sin repositorio base, cada acceso a
     datos tendría que acordarse de hacer `SET LOCAL` manualmente.
3. **Defensa en profundidad: RLS + middleware + repositorio base** (recomendado en RFC-003) — las
   tres capas trabajando juntas, cada una asumiendo que las otras van a fallar algún día.
   - Pros: ningún punto único de falla; consistente con el patrón que el propio código ya usa para
     `requestId` (`AsyncLocalStorage` + middleware, ver `lib/request-context.ts` en cada servicio).
   - Contras: más superficie de código a mantener; requiere disciplina en cada PR (revisar que
     nadie bypasee el repositorio base).

## Decisión

Elegimos la **Opción 3: defensa en profundidad (RLS + middleware + repositorio base)**, ratificada
por Ricardo el 2026-07-29. Consistente con ADR-005 (RLS como capa de motor) y con el patrón ya
existente en el repo para `requestId` (`AsyncLocalStorage` + middleware, ver
`lib/request-context.ts` de cada servicio) — el `TenantContext` de la Fase 3 sigue el mismo patrón,
solo que ninguna capa se considera suficiente por sí sola.

## Consecuencias

- **Positivas:** ningún punto único de falla — un bug de código se detiene en RLS aunque el
  middleware o el repositorio base tengan un gap; consistente con la lección del bug real de
  `event-consumer.ts` (confiar en una sola capa falla en producción, no en desarrollo).
- **Negativas / tradeoffs:** más superficie de código a mantener; cada servicio nuevo (Fase 8:
  `tenant-provisioning`) también debe adoptar las tres capas desde su creación, no como una
  segunda pasada; requiere disciplina de code review para detectar accesos a datos que bypaseen el
  repositorio base.
- **Cosas a monitorear:** intentos de acceso cross-tenant bloqueados por RLS pero no por la capa
  de aplicación (señal de que el middleware tiene un gap) — debe generar una alarma dedicada
  (Fase 6, "intentos de acceso cross-tenant detectados").

## Referencias
- `docs/rfc/RFC-003-tenancy.md`, sección "Estrategia de enforcement"
- `SPEC.md`, changelog 2026-06-21 (bug real de `event-consumer.ts`, análogo en espíritu: confiar
  en una sola capa sin verificación falla en producción, no en desarrollo)
