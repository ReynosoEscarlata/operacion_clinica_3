// Interfaz estructural mínima (no `pino.Logger` completo): este paquete solo
// necesita poder loguear un objeto y leer los bindings del logger que cada
// caller ya tiene configurado. Reducirla a lo que realmente se usa permite
// que tanto una instancia real de Pino (los 5 servicios + gateway) como
// `request.log` de Fastify (un `FastifyBaseLogger`, que no es
// estructuralmente idéntico a `pino.Logger` aunque esté implementado con
// Pino por debajo) satisfagan el tipo sin casts -- packages/authz pasa
// `request.log` a logAuthzDenied() y no tiene forma de construir un
// `pino.Logger` completo por su cuenta.
export interface Logger {
  info: (mergeObject: object, message?: string) => void;
  warn: (mergeObject: object, message?: string) => void;
  error: (mergeObject: object, message?: string) => void;
  // Opcional: `FastifyBaseLogger` (el tipo de `request.log`) no lo declara
  // en su interfaz pese a que en runtime SÍ es un Pino real con `.bindings()`
  // -- ver resolveServiceName() en packages/authz/src/require-permission.ts,
  // que hace el fallback correspondiente cuando no está.
  bindings?: () => Record<string, unknown>;
}
