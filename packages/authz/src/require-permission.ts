import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import type { AuthActor } from './actor.js';
import { can } from './can.js';
import type { Permission } from './permissions.js';

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
    authz?: { permission: Permission } | { public: true };
  }
}

// Puerta RBAC a nivel de ruta (capa 1 de 3, ver ADR-012). Responde 403 en
// vez de lanzar AppError: cada servicio define su propia clase AppError
// (duplicada a propósito, mismo patrón que event-consumer.ts, ver ADR-012
// "Cosas a monitorear") y un `throw` aquí no sería `instanceof` la de cada
// servicio -- una respuesta directa evita ese acoplamiento cruzado.
export const requirePermission = (permission: Permission): preHandlerHookHandler =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.authActor || !can(request.authActor, permission)) {
      await reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Permiso requerido: ${permission}`,
          requestId: request.id,
        },
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
