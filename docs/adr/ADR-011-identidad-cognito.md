# ADR-011: Identidad — Cognito user pool compartido vs. pool por tenant

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

Hoy `services/auth` implementa login/JWT/JWKS propio (RS256, llave en memoria del proceso —
riesgo ya documentado en `docs/security/threat-model.md` amenaza #19). El plan maestro (Fase 2)
propone migrar a Cognito, con `tenant_id` como atributo custom inyectado al JWT vía un trigger de
pre-token-generation. La pregunta de este ADR es cuántos user pools usar, no si usar Cognito (eso
ya está decidido por el plan maestro en la Fase 2, que este ADR no reabre).

## Opciones consideradas

1. **Un único user pool compartido** para todas las clínicas, con `tenant_id` como atributo custom
   por usuario.
   - Pros: consistente con el modelo de tenancy "shared DB + tenant_id" (ADR-005, si se ratifica
     así) — mismo patrón aplicado a identidad; onboarding de una clínica nueva no requiere
     aprovisionar infraestructura de Cognito, solo crear usuarios con el atributo correcto.
   - Contras: un bug en el trigger de pre-token-generation (el que inyecta `tenant_id` al JWT)
     afecta a todas las clínicas simultáneamente — es el mismo tipo de riesgo que "shared DB" pero
     aplicado a autenticación, con el agravante de que un JWT mal emitido es un vector de
     Elevation of Privilege directo (amenaza #1 del threat model).
2. **Un user pool por tenant** — aislamiento de identidad físico entre clínicas.
   - Pros: un bug de configuración de Cognito en un pool no puede afectar a otra clínica; permite
     políticas de contraseña/MFA distintas por cliente si algún contrato lo exige.
   - Contras: Cognito tiene límites de pools por cuenta/región que hacen esto inviable a 1000
     clínicas sin un plano de control de aprovisionamiento de pools (que no existe hoy); rompe la
     compatibilidad directa con "onboarding en <30 min" salvo que ese aprovisionamiento esté
     completamente automatizado desde el día 1 de la Fase 8.
3. **Pool compartido para roles de tenant + pool separado para roles de plataforma**
   (`platform_admin`/`platform_support`, RFC-004) — variante de la Opción 1 que separa
   explícitamente los dos planos de autorización a nivel de identidad, no solo de permisos.
   - Pros: un compromiso del pool de clientes nunca puede escalar directamente a acceso de
     plataforma, porque son sistemas de identidad físicamente distintos.
   - Contras: dos pools que mantener, dos flujos de login distintos (el panel admin de plataforma
     vs. el panel de cada clínica).

## Decisión

Elegimos la **Opción 1: un único user pool compartido**, incluyendo los roles de plataforma
(`platform_admin`/`platform_support`) en el mismo pool que los roles de tenant, distinguidos por
atributos/claims (no por pool separado). Ricardo priorizó explícitamente simplicidad operativa —
un solo flujo de login, un solo pool que mantener — sobre el aislamiento adicional que daría un
pool de plataforma separado (Opción 3), consistente con la misma priorización ya hecha en ADR-009.

## Consecuencias

- **Positivas:** un solo flujo de autenticación que implementar y mantener; consistente con el
  modelo de tenancy "shared DB" de ADR-005 — mismo patrón aplicado a identidad.
- **Negativas / tradeoffs:** un compromiso de credenciales o un bug en el trigger de
  pre-token-generation que inyecta `tenant_id`/roles al JWT tiene, en principio, blast radius sobre
  toda la plataforma **incluyendo las cuentas de plataforma** — no hay el límite físico adicional
  que daría un pool separado para `platform_admin`/`platform_support`. Este riesgo se acepta
  explícitamente; debe compensarse con controles más estrictos sobre esas cuentas específicas
  (MFA obligatorio, políticas de contraseña reforzadas, alertas de acceso) ya que no hay aislamiento
  de pool que las proteja.
- **Cosas a monitorear:** el mismo riesgo que ya existe hoy con la llave JWT en memoria (amenaza
  #19 del threat model) se traslada aquí a la configuración del trigger de pre-token-generation —
  un bug ahí es equivalente en severidad y ahora afecta también a las cuentas de plataforma; MFA y
  controles reforzados para `platform_admin`/`platform_support` deben priorizarse en la Fase 4
  como mitigación del trade-off aceptado en este ADR.

## Referencias
- `docs/security/threat-model.md`, amenaza #1 y #19
- `docs/rfc/RFC-004-rbac.md` (los dos planos de autorización)
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 2, punto 7
