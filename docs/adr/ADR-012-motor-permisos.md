# ADR-012: Modelo de autorización y dónde vive el motor de permisos

**Fecha:** 2026-07-29
**Estado:** Propuesto — **PENDIENTE DE DECISIÓN HUMANA** (depende de RFC-004)
**Decisor(es):** Ricardo Reynoso

## Contexto

`docs/rfc/RFC-004-rbac.md` ya estableció el modelo (RBAC para la puerta de entrada + ABAC para
propiedad del recurso). Este ADR decide la pieza de implementación que el RFC no cubre: **dónde
vive el motor que evalúa `can(user, action, resource)`** — ¿en el gateway (un solo lugar), en cada
servicio (duplicado), o en una librería compartida?

## Opciones consideradas

1. **Motor de permisos en el gateway únicamente** — el gateway decide antes de proxyar.
   - Pros: un solo lugar que auditar; los servicios de atrás no necesitan lógica de autorización.
   - Contras: el gateway no tiene el recurso concreto en la mayoría de los casos (ej. no sabe si
     `Appointment.doctorId` coincide con el actor sin consultar al servicio) — la regla ABAC de
     propiedad del médico (RFC-004) requiere el dato del recurso, que vive en Appointments, no en
     el gateway. Forzaría al gateway a hacer una consulta extra antes de decidir, duplicando el
     trabajo que el servicio ya iba a hacer.
2. **Motor de permisos duplicado en cada servicio** — cada uno implementa su propio `can()`.
   - Pros: cada servicio tiene acceso directo a sus propios recursos para evaluar ABAC sin
     llamadas extra.
   - Contras: 5 implementaciones que mantener en sincronía con la misma matriz de RFC-004 — el
     mismo patrón de duplicación deliberada que ya usa el repo para `event-consumer.ts` (según
     `SPEC.md`, "idéntico en Appointments y Notifications... mismo criterio"), pero aplicado a
     lógica de seguridad, donde una divergencia entre copias es más peligrosa que en un consumer
     de eventos.
3. **Librería compartida de autorización** (`packages/authz/`, análogo a `packages/contracts/`
   que ya existe para OpenAPI) — RBAC evaluado como middleware declarativo
   (`requirePermission('appointment:cancel')`) importado por cada servicio, con la matriz de
   permisos como una única fuente de verdad versionada; el filtro ABAC de propiedad se aplica
   dentro del repositorio de cada servicio (porque necesita el dato del recurso), pero usando
   tipos/constantes de la misma librería.
   - Pros: una sola definición de la matriz rol×permiso (evita que RFC-004 y el código diverjan
     silenciosamente); consistente con el patrón que el repo ya usa para contratos compartidos.
   - Contras: introduce una dependencia interna nueva que los 5 servicios deben importar y
     versionar juntos — un cambio a la librería requiere rebuild/redeploy coordinado si no se
     versiona con cuidado.

## Decisión

**PENDIENTE DE DECISIÓN HUMANA.**

## Consecuencias

- **Positivas:** *(pendiente)*
- **Negativas / tradeoffs:** *(pendiente)*
- **Cosas a monitorear:** si se elige la Opción 3, vigilar que `packages/authz/` no se convierta en
  un cuello de botella de despliegue (todo servicio depende de su versión) — mismo riesgo que ya
  existe hoy con `packages/contracts/` duplicado a mano en `gateway/openapi-specs/` (documentado
  en `SPEC.md` como trade-off aceptado).

## Referencias
- `docs/rfc/RFC-004-rbac.md`
- `SPEC.md`, Fase 4 (patrón de duplicación deliberada de `event-consumer.ts` y de
  `packages/contracts/`)
