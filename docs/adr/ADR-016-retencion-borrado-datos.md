# ADR-016: Estrategia de retención y borrado de datos personales

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

La LFPDPPP vigente introduce expresamente la figura del "plazo de conservación", pero **su
reglamento aún no existe** (pendiente a la fecha de este documento) — el reglamento de 2011 aplica
de forma supletoria en lo que no contradiga la ley nueva. Esto significa que cualquier plazo de
retención que se fije hoy es una decisión de negocio informada por una ley sin reglamento
operativo todavía, no un número que la ley dicte con precisión.

El sistema hoy no tiene ningún mecanismo de purga ni de borrado verificable — ni de datos vivos en
Postgres, ni de backups, ni de logs en CloudWatch (que ni siquiera existe todavía).

## Opciones consideradas

1. **Retención hardcodeada por tipo de dato** (ej. "los datos de un paciente se retienen 5 años
   tras su última cita, punto").
   - Pros: simple de implementar, sin configuración adicional.
   - Contras: cuando el reglamento de la LFPDPPP se publique, un cambio de plazo requeriría una
     nueva versión de código en vez de un cambio de configuración — exactamente el riesgo que el
     plan maestro pide evitar explícitamente ("documenta tus decisiones de retención... de modo
     que cuando el reglamento se publique el cambio sea un ajuste de configuración").
2. **Retención configurable por tenant y por categoría de dato**, con un job de purga que lee la
   configuración en vez de un valor fijo en código.
   - Pros: un cambio de plazo (por el reglamento nuevo, o porque una clínica lo pide
     contractualmente) es una operación de configuración, no un despliegue; permite que distintas
     categorías de dato (ej. datos de facturación vs. historial de citas) tengan plazos distintos
     si la ley eventualmente los diferencia.
   - Contras: más superficie de configuración que auditar — un plazo mal configurado por error
     humano podría purgar datos antes de tiempo (irreversible) o retenerlos de más (riesgo de
     compliance por sí mismo).
3. **Sin retención activa, solo borrado bajo solicitud ARCO** (el sistema nunca purga
   proactivamente, solo responde a solicitudes explícitas del titular).
   - Pros: la implementación mínima — solo se necesita el flujo de derechos ARCO (ya requerido de
     todas formas por la Fase 5), sin construir un job de purga automática.
   - Contras: no cumple con el espíritu de "plazo de conservación" que la ley nueva introduce
     expresamente — depender solo de que el titular lo solicite no es lo mismo que tener una
     política de retención activa, y es más difícil de defender ante una auditoría.

## Decisión

Elegimos la **Opción 1: retención hardcodeada por tipo de dato**. Ricardo priorizó simplicidad de
implementación sobre la flexibilidad de configuración de la Opción 2, **aceptando explícitamente**
que esto va en contra de la recomendación del plan maestro ("documenta tus decisiones de retención
de modo que un cambio de plazo sea un ajuste de configuración, no un rediseño") — el trade-off se
documenta aquí precisamente para que sea una decisión consciente, no un descuido.

**Mitigación mínima acordada:** los plazos hardcodeados deben vivir como constantes nombradas en
un único módulo (ej. `lib/retention-policy.ts` por servicio, o un módulo compartido si
`packages/authz/` de ADR-012 sienta el precedente de librería compartida), nunca dispersos como
números mágicos en el código de negocio — así, aunque un cambio de plazo requiera un despliegue,
al menos es un cambio de una línea en un lugar conocido, no una búsqueda a través del código.

## Consecuencias

- **Positivas:** implementación más simple y rápida — sin necesidad de construir un sistema de
  configuración de retención por tenant/categoría antes de tener un solo tenant real.
- **Negativas / tradeoffs:** **cuando se publique el reglamento de la LFPDPPP** (pendiente a la
  fecha de este ADR) **o cuando una clínica pida contractualmente un plazo distinto, el cambio
  requiere una nueva versión de código y su despliegue**, no un ajuste de configuración — esto es
  exactamente el riesgo que el plan maestro pedía evitar. Se acepta conscientemente, mitigado por
  la centralización de constantes descrita arriba.
- **Cosas a monitorear:** fecha de publicación del reglamento de la LFPDPPP — este ADR **debe
  revisarse explícitamente** en cuanto exista, y no quedar aceptado indefinidamente sin
  reconsiderar si la Opción 2 (configurable) se vuelve necesaria en ese momento; cualquier purga
  activa que se implemente sobre esta base debe garantizar borrado en cascada verificable —
  incluyendo backups y logs de CloudWatch, el caso que el plan maestro señala explícitamente como
  "el que casi todos olvidan".

## Referencias
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 5 (contexto legal LFPDPPP completo)
- `docs/security/threat-model.md` (datos de salud como banda de severidad máxima)
