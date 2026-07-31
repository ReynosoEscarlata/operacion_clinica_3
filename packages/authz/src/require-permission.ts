import { logAuthzDenied, type Logger } from '@clinica/observability';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import type { AuthActor } from './actor.js';
import { can } from './can.js';
import type { Permission } from './permissions.js';

// `request.log` ya es un child logger con `{ service: '<nombre>' }` como
// binding (ver lib/logger.ts + middleware/request-id.ts de cada servicio,
// que hace `logger.child({ requestId })`) -- este paquete es compartido
// entre los 6 procesos y no puede saber su propio nombre de servicio de
// antemano, así que lo lee de ahí en vez de hardcodearlo (evita
// sobreescribir el binding real con un valor genérico al pasar `service`
// explícito en la llamada de log).
const resolveServiceName = (logger: Logger): string => {
  const bindings = logger.bindings?.();
  return typeof bindings?.service === 'string' ? bindings.service : 'unknown';
};

declare module 'fastify' {
  interface FastifyRequest {
    // Poblado por el middleware authz-context.ts de cada servicio (mismo
    // molde que tenant-context.ts para tenantId) a partir de los headers
    // internos que reenvía el gateway.
    authActor?: AuthActor;
  }
  interface FastifyContextConfig {
    // Toda ruta bajo /v1/* debe declarar exactamente una de las dos formas
    // -- lo exige registerAuthzEnforcement en el arranque (fail-closed).
    // `allowAnonymous` cubre el caso real de RFC-004 donde una ruta es
    // pública para el paciente sin cuenta (ningún AuthActor, RFC-001) PERO
    // sigue excluyendo explícitamente a algún rol autenticado concreto (ej.
    // appointment:create: el paciente puede, pero doctor no) -- `public`
    // liso no alcanza ahí porque desactivaría el chequeo también para esos
    // roles excluidos.
    authz?: { permission: Permission; allowAnonymous?: boolean } | { public: true };
  }
}

// Puerta RBAC a nivel de ruta (capa 1 de 3, ver ADR-012). Responde 403 en
// vez de lanzar AppError: cada servicio define su propia clase AppError
// (duplicada a propósito, mismo patrón que event-consumer.ts, ver ADR-012
// "Cosas a monitorear") y un `throw` aquí no sería `instanceof` la de cada
// servicio -- una respuesta directa evita ese acoplamiento cruzado.
export const requirePermission = (
  permission: Permission,
  options: { allowAnonymous?: boolean } = {},
): preHandlerHookHandler =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.authActor) {
      if (options.allowAnonymous) return;
      logAuthzDenied(request.log, {
        service: resolveServiceName(request.log),
        permission,
        actorRole: 'anonimo',
        actorSub: null,
        actorTenantId: null,
      });
      await reply.status(403).send({
        error: { code: 'FORBIDDEN', message: `Permiso requerido: ${permission}`, requestId: request.id },
      });
      return;
    }
    if (!can(request.authActor, permission)) {
      logAuthzDenied(request.log, {
        service: resolveServiceName(request.log),
        permission,
        actorRole: request.authActor.role,
        actorSub: request.authActor.sub,
        actorTenantId: request.authActor.tenantId,
      });
      await reply.status(403).send({
        error: { code: 'FORBIDDEN', message: `Permiso requerido: ${permission}`, requestId: request.id },
      });
    }
  };

// Fail-closed (DoD de Fase 4, plan maestro): toda ruta bajo /v1/* debe
// declarar config.authz.{permission|public} al registrarse. Una ruta nueva
// sin declaración tumba el arranque del proceso en vez de quedar
// silenciosamente sin protección. Se registra ANTES de llamar a
// registerXRoutes (el hook `onRoute` se dispara síncronamente dentro de
// cada app.get/post/...).
export const registerAuthzEnforcement = (app: FastifyInstance): void => {
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/v1/')) return; // health, metrics: fuera del alcance de RFC-004
    if (!route.config?.authz) {
      throw new Error(
        `Ruta ${route.method} ${route.url} no declara config.authz.{permission|public} ` +
          '-- ver packages/authz/README.md',
      );
    }
  });
};
