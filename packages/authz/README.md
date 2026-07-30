# @clinica/authz

Motor de permisos compartido (RBAC + ABAC) de la Fase 4 del Challenge 5. Implementa
`docs/rfc/RFC-004-rbac.md` y ADR-012 (`docs/adr/ADR-012-motor-permisos.md`).

## Qué resuelve

- `PERMISSION_MATRIX`: transcripción literal de la matriz rol × permiso de RFC-004. Cambiarla es
  cambiar el RFC, no un detalle de implementación — cualquier edición debe reflejarse primero ahí.
- `can(actor, permission)`: la puerta RBAC ("¿este rol puede en principio hacer esto?"). Nunca
  decide sobre el recurso concreto.
- `isOwnScoped(actor, permission)`: le dice al repositorio de cada servicio si debe aplicar su
  propio filtro ABAC de propiedad (la celda es `'own'`, no `'all'`).
- `requirePermission(permission)`: `preHandler` de Fastify que responde `403 FORBIDDEN` si
  `!can(request.authActor, permission)`.
- `registerAuthzEnforcement(app)`: fail-closed — cualquier ruta bajo `/v1/*` que no declare
  `config: { authz: { permission } | { public: true } }` tumba el arranque del servicio.

## Uso en un servicio

```ts
import { requirePermission } from '@clinica/authz';

app.get(
  '/v1/appointments',
  {
    schema: { querystring: ListAppointmentsQuery },
    config: { authz: { permission: 'appointment:list' } },
    preHandler: requirePermission('appointment:list'),
  },
  controller.list,
);

// Ruta pública: igual debe declarar config.authz, con `public: true`.
app.post(
  '/v1/appointments',
  { schema: { body: CreateAppointmentBody }, config: { authz: { public: true } } },
  controller.create,
);
```

`request.authActor` lo puebla el middleware `authz-context.ts` de cada servicio (mismo molde que
`tenant-context.ts` para `tenantId`), a partir de los headers internos que reenvía el gateway:
`TENANT_ID_HEADER`, `USER_ROLE_HEADER`, `DOCTOR_ID_HEADER` (y `SUPPORT_GRANT_ID_HEADER` cuando el
request opera bajo un JWT de elevación de `platform_support`).

## Qué NO hace

- No conoce recursos concretos. El filtro ABAC de propiedad (p. ej. "el doctor solo ve sus propias
  citas") vive en el repositorio de cada servicio, usando `isOwnScoped()` como señal.
- No reemplaza el aislamiento de tenant (RLS + `tenant-context.ts`, RFC-003) — son capas
  independientes que se combinan, no una la sustituye a la otra.
