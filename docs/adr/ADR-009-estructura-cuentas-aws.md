# ADR-009: Estructura de cuentas y entornos AWS

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

El sistema no tiene hoy ningún entorno en AWS (Supuesto S7 confirmado). Al no existir producción
real todavía (confirmado por Ricardo en Fase 0: "actualmente es un ambiente de pruebas... pero
tenemos que simular que corre tráfico"), esta decisión define el blast radius de cualquier error
de configuración desde el primer despliegue, no solo en el futuro.

## Opciones consideradas

1. **Una sola cuenta AWS con 3 entornos lógicos** (dev/staging/prod separados por prefijo de
   recurso/tag, misma cuenta).
   - Pros: setup inicial más simple, sin necesidad de AWS Organizations ni de gestionar múltiples
     credenciales/roles cross-cuenta.
   - Contras: un error de IAM en dev puede alcanzar prod (mismo límite de cuenta); los límites de
     servicio (service quotas) se comparten entre entornos; un incidente de seguridad en dev
     compromete potencialmente el mismo blast radius que uno en prod.
2. **AWS Organizations con una cuenta por entorno** (dev, staging, prod, y opcionalmente una cuenta
   de logging/auditoría central).
   - Pros: el aislamiento de prod es un límite de cuenta de IAM, no una convención de nombres —
     un error de permisos en dev no puede alcanzar prod ni con un bug; SCPs (Service Control
     Policies) pueden prohibir acciones peligrosas (ej. borrar CloudTrail) a nivel de cuenta.
   - Contras: más complejidad operativa inicial (bootstrap de Organizations, roles cross-cuenta
     para CI/CD, IAM Identity Center); requiere más disciplina desde el día 1.
3. **Una cuenta por servicio** (variante extrema de la 2, aislando también entre servicios, no
   solo entre entornos).
   - Pros: blast radius mínimo también entre `auth`/`appointments`/etc.
   - Contras: complejidad desproporcionada para 5 servicios y un presupuesto austero; el
     aislamiento entre servicios ya se resuelve con IAM roles/security groups dentro de una cuenta,
     sin necesitar el overhead de Organizations por servicio.

## Decisión

Elegimos la **Opción 1: una sola cuenta AWS con 3 entornos lógicos** (dev/staging/prod separados
por prefijo de recurso y tags, no por cuenta). Ricardo revirtió explícitamente la inclinación de
Fase 0 (Organizations con cuenta por entorno) el 2026-07-29, priorizando simplicidad operativa
inicial sobre el aislamiento máximo de prod — aceptando el trade-off descrito abajo como riesgo
consciente, no como omisión.

## Consecuencias

- **Positivas:** setup inicial mucho más simple — sin bootstrap de AWS Organizations, sin roles
  cross-cuenta para CI/CD, un solo conjunto de credenciales OIDC que gestionar. Menor fricción
  para empezar la Fase 2 de inmediato.
- **Negativas / tradeoffs:** **el aislamiento de prod pasa a depender de IAM policies y
  convenciones de naming/tagging, no de un límite de cuenta** — un error de permisos o una SCP mal
  probada en dev puede, en principio, alcanzar prod. Esto es exactamente el escenario que la
  inclinación original buscaba evitar (ver amenaza relacionada en `docs/security/threat-model.md`).
  Se acepta este riesgo explícitamente; si la plataforma escala a más clínicas o a un contrato que
  exija aislamiento de cuenta por compliance, este ADR debe revisarse.
- **Cosas a monitorear:** cualquier incidente donde un cambio en dev/staging haya tenido efecto en
  prod (aunque sea menor) es una señal directa de que este trade-off dejó de ser aceptable y hay
  que migrar a Organizations; revisar también los límites de servicio compartidos entre entornos
  (quotas de RDS, ECS, etc. se comparten en una sola cuenta).

## Referencias
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, sección 2 (D5) y Fase 2 (Landing zone)
