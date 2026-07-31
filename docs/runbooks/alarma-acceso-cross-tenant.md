# Runbook — Acceso cross-tenant confirmado (`clinica-<env>-cross-tenant-access-denied`)

**Alcance:** una sola alarma agregada (namespace `Clinica/Security`, métrica `CrossTenantAccessDenied`,
sin dimensión de servicio) alimentada por 6 `logs.MetricFilter`, uno por cada log group de
`/clinica/<servicio>` (ver `infra/lib/stacks/observability-stack.ts`). Notifica a
`clinica-<env>-security-alerts` (Fase 6, ADR-017) — audiencia distinta de la guardia técnica: un
evento acá es un posible incidente LFPDPPP (Ley Federal de Protección de Datos Personales en
Posesión de los Particulares), no un ticket operativo.

**Nunca ejecutado por Claude Code.**

---

## Síntoma

Mensaje en `clinica-<env>-security-alerts`: al menos 1 línea de log con
`event = 'cross_tenant_access_denied'` en cualquiera de los 6 procesos.

Contexto (amenaza #3 del threat model, IDOR por posesión de UUID): un actor con tenant ambiental
(admin/staff autenticado) pidió un recurso (cita o paciente) por su UUID, la consulta scoped por RLS
no lo encontró, y al resolver el tenant real del recurso vía `resolve_tenant_for_appointment`/
`resolve_tenant_for_patient` (SECURITY DEFINER, bypassa RLS) resultó ser de OTRO tenant. La
respuesta HTTP al actor siguió siendo el mismo 404 de siempre — cambiarla a 403 filtraría
existencia, exactamente lo que el threat model prohíbe — este evento es el registro que corre en
paralelo a esa respuesta.

## Diagnóstico

1. Identificar el/los eventos exactos con la query de forense (`consultas-logs-insights.md`,
   sección "Acceso cross-tenant"):
   ```
   filter event = 'cross_tenant_access_denied'
   | fields @timestamp, actorSub, actorRole, actorTenantId, resourceTenantId, resource, resourceId, requestId, traceId
   | sort @timestamp desc
   ```
2. Con el `traceId` de cada evento, abrir la consola de X-Ray → Traces y pegar el ID para ver la
   traza completa de esa request (qué endpoint exacto, qué devolvió, en qué momento).
3. Revisar TODAS las requests del mismo `actorSub` en la ventana del incidente:
   ```
   filter actorSub = "<actor-sub>"
   | fields @timestamp, service, route, statusCode, requestId
   | sort @timestamp asc
   ```

## Decisión

Criterio bug-vs-abuso:

- **Un solo `resourceId` repetido pocas veces, mismo actor, patrón consistente con un typo/copia de
  UUID equivocada (ej. un admin pegó el id de una cita de otra pestaña)** → probablemente accidental.
  No requiere escalar como incidente, pero sí registrar en el post-mortem de este runbook.
- **Muchos `resourceId` distintos en poco tiempo, mismo actor** → patrón de enumeración/scanning
  deliberado. Escalar como incidente de seguridad — no esperar a más señales.
- **Múltiples actores del mismo tenant probando ids de otros tenants** → posible compromiso de
  credenciales o abuso coordinado. Escalar de inmediato.

## Pasos

- **Accidental (1-2 eventos, patrón consistente con error humano):** ninguna acción de contención.
  Continuar a Verificación.
- **Sospechoso o confirmado como deliberado:**
  1. Congelar la sesión del actor: revocar sus refresh tokens (`services/auth`, endpoint de
     revocación de sesión) para forzar re-login.
  2. Si el patrón involucra a un `platform_support` con `SupportAccessGrant` activo (RFC-004),
     revisar si el grant sigue vigente y revocarlo si corresponde.
  3. Documentar el incidente según el procedimiento de gestión de incidentes LFPDPPP vigente
     (fuera del alcance de este runbook — coordinar con quien tenga esa responsabilidad).

## Verificación

- La alarma vuelve a `OK` (sin nuevos eventos en el período de evaluación).
- El `resourceTenantId` real del recurso no fue expuesto al actor en ningún momento (confirmar que
  la respuesta HTTP siguió siendo 404, revisando el `statusCode` de la traza).

## Comunicación

Cualquier evento clasificado como "sospechoso" o "confirmado" en la sección Decisión se comunica
de inmediato a quien tenga la responsabilidad de incidentes de datos personales — no esperar al
cierre de la investigación técnica para notificar.

## Post-mortem

El post-mortem de este runbook **debe terminar en un test nuevo** bajo `tests/isolation/` del
servicio correspondiente, que reproduzca el escenario exacto (mismo tipo de recurso, mismo patrón
de acceso) y confirme que la detección lo hubiera capturado — no alcanza con confirmar que el 404
seguía siendo correcto, hay que confirmar que el evento de auditoría se generó.
