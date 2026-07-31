import { getAuthActor } from './authz-context.js';

// RFC-004, regla ABAC de propiedad: appointment:read/list/cancel/complete/
// mark_no_show son 'own' para el rol doctor -- solo sobre sus propias
// citas (appointment.doctorId === actor.doctorId), nunca sobre las de otro
// doctor de la misma clínica. Para cualquier otro rol (o sin actor, ej. el
// paciente sin cuenta) esto siempre es false: la puerta RBAC
// (requirePermission) y el resto de la matriz ya deciden el acceso.
export const deniedByDoctorOwnership = (resourceDoctorId: string): boolean => {
  const actor = getAuthActor();
  return actor?.role === 'doctor' && actor.doctorId !== resourceDoctorId;
};
