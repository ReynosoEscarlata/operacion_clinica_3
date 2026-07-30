# ADR-016: Estrategia de retención y borrado de datos personales

**Fecha:** 2026-07-29
**Estado:** Propuesto — **PENDIENTE DE DECISIÓN HUMANA**
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

**PENDIENTE DE DECISIÓN HUMANA.**

## Consecuencias

- **Positivas:** *(pendiente)*
- **Negativas / tradeoffs:** cualquier opción con purga activa (2 o, parcialmente, 1) debe
  garantizar borrado en cascada verificable — incluyendo backups y logs de CloudWatch, el caso que
  el plan maestro señala explícitamente como "el que casi todos olvidan".
- **Cosas a monitorear:** fecha de publicación del reglamento de la LFPDPPP — este ADR debe tener
  una fecha de revisión explícita y no quedar "aceptado para siempre" sin reconsiderar los plazos
  una vez que exista el reglamento.

## Referencias
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 5 (contexto legal LFPDPPP completo)
- `docs/security/threat-model.md` (datos de salud como banda de severidad máxima)
