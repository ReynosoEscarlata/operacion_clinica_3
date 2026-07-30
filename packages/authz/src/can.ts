import type { AuthActor } from './actor.js';
import { PERMISSION_MATRIX } from './matrix.js';
import type { Permission } from './permissions.js';

// Puerta RBAC ("¿este rol puede en principio hacer esta acción?", RFC-004).
// 'own' cuenta como permitido aquí -- can() nunca decide sobre el recurso
// concreto, eso es el filtro ABAC de propiedad que vive en el repositorio
// de cada servicio (ADR-012).
export const can = (actor: AuthActor, permission: Permission): boolean => {
  const grant = PERMISSION_MATRIX[permission][actor.role];
  return grant === 'all' || grant === 'own';
};

// Para el filtro ABAC del repositorio: ¿esta celda es 'own', o el rol tiene
// acceso irrestricto ('all')? Permite a un repositorio decidir si debe
// aplicar el filtro de propiedad o no, sin repetir la matriz.
export const isOwnScoped = (actor: AuthActor, permission: Permission): boolean =>
  PERMISSION_MATRIX[permission][actor.role] === 'own';
