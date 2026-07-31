# ADR-010: Región AWS y residencia de datos (LFPDPPP)

**Fecha:** 2026-07-29
**Estado:** Reemplazado por ADR-018 (2026-07-31)
**Decisor(es):** Ricardo Reynoso

## Contexto

El sistema procesa datos de salud (sensibles bajo LFPDPPP, ver `docs/security/threat-model.md`).
La ley vigente (DOF, 20 de marzo de 2025) introduce expresamente la figura del "plazo de
conservación" y mantiene sanciones agravadas para datos sensibles — la residencia de los datos no
es un detalle técnico, es una decisión de compliance con consecuencias legales directas.

Verificación pendiente, servicio por servicio: no todos los servicios gestionados de AWS llegan a
todas las regiones al mismo tiempo (ej. Cognito, ciertas tallas de RDS/Fargate). `mx-central-1` es
una región relativamente nueva de AWS — la disponibilidad real de Cognito y de las tallas
específicas de RDS/ECS Fargate que este proyecto necesita debe confirmarse antes de tratar esta
decisión como cerrada (ver `docs/cost/precios-aws-consultados.md` para el estado de la
verificación de precios/disponibilidad).

## Opciones consideradas

1. **`mx-central-1` (México)** — residencia de datos dentro del país.
   - Pros: alineado directamente con LFPDPPP sin necesidad de justificar transferencia
     internacional en el aviso de privacidad; menor latencia para clínicas mexicanas.
   - Contras: región nueva — riesgo de que algún servicio gestionado necesario (particularmente
     Cognito) no esté disponible ahí todavía, lo que forzaría un modelo híbrido (datos en México,
     identidad en otra región) con su propia complejidad de compliance.
2. **`us-east-1`** — región más madura y barata de AWS.
   - Pros: disponibilidad completa de todos los servicios gestionados sin excepción; precios
     históricamente más bajos que otras regiones.
   - Contras: implica transferencia internacional de datos de salud — requiere justificación de
     compliance explícita en el aviso de privacidad y mecanismos de transferencia (cláusulas
     contractuales o equivalente) documentados.
3. **`us-west-2`** — alternativa a `us-east-1` con menor latencia para México.
   - Pros: mismo argumento de madurez de servicios que `us-east-1`, latencia algo mejor.
   - Contras: misma implicación de transferencia internacional que la Opción 2.

## Decisión

Elegimos la **Opción 1: `mx-central-1`**. La condición de la Fase 0 (verificar disponibilidad de
Cognito, RDS y ECS Fargate) se cumplió: `docs/cost/precios-aws-consultados.md` confirma que los 11
servicios investigados tienen SKU propio publicado en `mx-central-1`, y Cognito se lanzó ahí
oficialmente en julio de 2025 (anuncio oficial citado en ese documento). No fue necesario el
fallback a `us-east-1` para ningún componente. Ricardo ratificó el 2026-07-29, aceptando la
recomendación de verificar en consola/Pricing Calculator antes del primer despliegue real (pricing
publicado es evidencia fuerte pero no 100% concluyente de disponibilidad operativa completa, según
la nota de esa misma investigación).

## Consecuencias

- **Positivas:** residencia de datos de salud en México desde el diseño, sin necesidad de
  justificar transferencia internacional en el aviso de privacidad (Fase 5); alineado directo con
  LFPDPPP.
- **Negativas / tradeoffs:** `mx-central-1` es una región relativamente nueva de AWS — algunos
  servicios de nicho (fuera de los 11 ya verificados) podrían no estar disponibles si el diseño los
  necesitara más adelante; los precios en `mx-central-1` son ligeramente más altos que en
  `us-east-1` en varios servicios (ej. ~5% más caro en Fargate, ver cost/precios-aws-consultados.md).
- **Cosas a monitorear:** verificación operativa final en consola AWS antes del primer despliegue
  real a `mx-central-1` (pendiente, no bloqueante para continuar el diseño); anuncios de AWS sobre
  nuevos servicios en esta región, por si el diseño necesita algo no cubierto hoy. Fecha de
  revisión sugerida: antes de la Fase 2 (fundación de infraestructura).

## Referencias
- `docs/cost/precios-aws-consultados.md` (verificación de disponibilidad de servicios en
  `mx-central-1`)
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, sección 2 (D4) y Fase 5 (contexto legal
  LFPDPPP)

## Changelog
- 2026-07-31: reemplazado por `ADR-018-cambio-region-us-east-1.md` — Ricardo confirmó que la
  cuenta/región disponible para el primer despliegue real es `us-east-1`, no `mx-central-1`. El
  contenido de este ADR (Contexto, Opciones, Decisión, Consecuencias) queda sin modificar como
  registro histórico de por qué se eligió `mx-central-1` originalmente.
