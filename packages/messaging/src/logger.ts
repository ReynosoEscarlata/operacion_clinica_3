// Shape mínima compatible con pino.Logger (cada servicio pasa su propio
// logger real) -- sin depender de `pino` como dependencia de este paquete,
// que es puramente de mensajería.
export interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}
