# ADR-010: Región AWS y residencia de datos (LFPDPPP)

**Fecha:** 2026-07-29
**Estado:** Propuesto — inclinación registrada, **PENDIENTE DE RATIFICACIÓN HUMANA** (bloqueado
por verificación de disponibilidad de servicios)
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

**PENDIENTE DE RATIFICACIÓN HUMANA**, condicionada a una verificación técnica previa.

Inclinación registrada en Fase 0: `mx-central-1` si los servicios necesarios (particularmente
Cognito, RDS con las tallas requeridas, ECS Fargate) están disponibles ahí. **Esta condición debe
verificarse explícitamente antes de aceptar este ADR** — ver
`docs/cost/precios-aws-consultados.md` para el resultado de esa verificación. Si Cognito u otro
servicio crítico no está disponible en `mx-central-1`, la decisión pasa a ser explícita: datos en
México, plano de identidad en otra región, documentado como transferencia en el aviso de
privacidad — o, alternativamente, `us-east-1` con la justificación de compliance escrita
(ver plan maestro, sección 2, D4).

## Consecuencias

- **Positivas:** *(pendiente de la verificación de disponibilidad)*
- **Negativas / tradeoffs:** si se requiere el modelo híbrido (datos en México, identidad en otra
  región), el aviso de privacidad (Fase 5) debe documentar esa transferencia explícitamente, con
  su base legal.
- **Cosas a monitorear:** anuncios de AWS sobre nuevos servicios disponibles en `mx-central-1` —
  la fecha de revisión de este ADR debe ser explícita porque la disponibilidad de servicios en una
  región nueva cambia con el tiempo.

## Referencias
- `docs/cost/precios-aws-consultados.md` (verificación de disponibilidad de servicios en
  `mx-central-1`)
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, sección 2 (D4) y Fase 5 (contexto legal
  LFPDPPP)
