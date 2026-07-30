# ADR-005: Modelo de tenancy

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

Ver `docs/rfc/RFC-003-tenancy.md` para el análisis completo (comparativa, diff de código,
propagación de contexto, enforcement, ruta de escape). Este ADR registra la decisión formal una
vez que el RFC se apruebe; no duplica el análisis.

El sistema hoy no tiene ninguna columna de tenant en ningún esquema (confirmado en
`docs/baseline-challenge-4.md`, Supuesto S5 falso). La decisión afecta directamente el alcance de
la Fase 3 del plan maestro (migración + backfill vs. solo agregar una columna).

## Opciones consideradas

1. **Shared DB + `tenant_id` + Row Level Security** — un Postgres por servicio (los 5 ya
   existentes), columna `tenant_id` + política RLS por tabla.
   - Pros: costo marginal por clínica ≈0, onboarding compatible con <30 min, RLS da defensa a
     nivel de motor.
   - Contras: mismo "blast radius" físico entre clínicas; backup/restore no es granular por
     clínica sin trabajo adicional.
2. **Schema-per-tenant** — un schema de Postgres por clínica.
   - Pros: aislamiento lógico más fuerte que RLS puro; backup por schema es viable.
   - Contras: límites prácticos de Postgres en número de esquemas; sin soporte nativo de Prisma
     para migraciones multi-schema.
3. **DB-per-tenant** — una instancia/base completa por clínica.
   - Pros: aislamiento máximo; borrado/backup por cliente es una operación natural.
   - Contras: costo marginal por clínica rompe el presupuesto austero confirmado
     (~$150-300/mes @10 clínicas) antes de llegar a 100; onboarding más frágil (aprovisionar
     infraestructura nueva no es una operación de minutos garantizada).

## Decisión

Elegimos la **Opción 1: Shared DB + `tenant_id` + Row Level Security**, ratificada por Ricardo el
2026-07-29 sobre la inclinación ya registrada en la Fase 0. Se evaluó explícitamente la Opción 4
(híbrido pool+silo desde el diseño) y se descarta *por ahora*: con 0 clínicas reales hoy, construir
la capacidad de silo desde el día 1 es esfuerzo sin demanda demostrada. La ruta de escape
pool→silo (RFC-003) queda documentada y es la vía para atender un contrato grande si aparece, sin
necesidad de haberla construido de antemano.

## Consecuencias

- **Positivas:** costo marginal por clínica nueva ≈0 (una fila, no una instancia); onboarding de
  la Fase 8 puede ser una operación transaccional simple; RLS da defensa a nivel de motor incluso
  si el código de aplicación tiene un bug.
- **Negativas / tradeoffs:** todas las clínicas comparten el mismo blast radius físico por
  servicio — un incidente de infraestructura (no solo de código) afecta a todas simultáneamente;
  backup/restore granular por clínica requiere trabajo adicional (extraer filas, no adjuntar un
  archivo).
- **Cosas a monitorear:** número de clínicas activas vs. presupuesto real de RDS; incidentes de
  aislamiento detectados por la suite de tests de la Fase 3; latencia de queries a medida que
  crece el número de filas por tabla compartida; primera solicitud real de un cliente grande
  pidiendo aislamiento dedicado (dispara la ruta de escape a silo, documentada en RFC-003).

## Referencias
- `docs/rfc/RFC-003-tenancy.md`
- `docs/baseline-challenge-4.md` (Supuesto S5)
- `docs/backlog-deuda.md` (ítems 1-4, BLOQUEA-MULTITENANCY)
