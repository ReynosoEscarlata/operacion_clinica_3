# ADR-009: Estructura de cuentas y entornos AWS

**Fecha:** 2026-07-29
**Estado:** Propuesto — inclinación registrada, **PENDIENTE DE RATIFICACIÓN HUMANA**
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

**PENDIENTE DE RATIFICACIÓN HUMANA.** Inclinación registrada en Fase 0: Opción 2 (Organizations
con cuenta por entorno), sin objeción de Ricardo — "el aislamiento de prod es parte del threat
model, no un lujo" (razonamiento ya incluido en el plan maestro, sección 2).

## Consecuencias

- **Positivas:** un error de configuración en dev (ej. una SCP mal probada, un IAM role
  sobre-permisivo de prueba) no puede alcanzar prod por diseño, no por disciplina.
- **Negativas / tradeoffs:** el pipeline de CI/CD (Fase 9) necesita gestionar credenciales/roles
  distintos por cuenta (vía OIDC, sin llaves de acceso de larga vida) — más piezas móviles que un
  solo `AWS_ACCESS_KEY_ID`.
- **Cosas a monitorear:** costo de mantener 3 cuentas activas (NAT Gateway, RDS, etc. se
  duplican/triplican si cada entorno tiene su propia infraestructura completa) contra el
  presupuesto austero — dev/staging pueden usar tallas menores y apagarse fuera de horario.

## Referencias
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, sección 2 (D5) y Fase 2 (Landing zone)
