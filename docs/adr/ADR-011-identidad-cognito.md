# ADR-011: Identidad — Cognito user pool compartido vs. pool por tenant

**Fecha:** 2026-07-29
**Estado:** Propuesto — **PENDIENTE DE DECISIÓN HUMANA** (depende de ADR-005 y ADR-010)
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

**PENDIENTE DE DECISIÓN HUMANA.**

## Consecuencias

- **Positivas:** *(pendiente)*
- **Negativas / tradeoffs:** *(pendiente)*
- **Cosas a monitorear:** el mismo riesgo que ya existe hoy con la llave JWT en memoria (amenaza
  #19) se traslada, si se elige la Opción 1 o 3, a la configuración del trigger de
  pre-token-generation — un bug ahí es equivalente en severidad.

## Referencias
- `docs/security/threat-model.md`, amenaza #1 y #19
- `docs/rfc/RFC-004-rbac.md` (los dos planos de autorización)
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 2, punto 7
