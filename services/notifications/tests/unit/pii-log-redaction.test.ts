import { Writable } from 'node:stream';

import { COMMON_REDACT_PATHS, REDACT_CENSOR } from '@clinica/audit-log';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { options } from '../../src/lib/logger.js';

const ROOT_FIELDS = COMMON_REDACT_PATHS.filter((path) => !path.startsWith('*.'));
const NESTED_FIELDS = COMMON_REDACT_PATHS.filter((path) => path.startsWith('*.')).map((path) =>
  path.replace('*.', ''),
);

// pino no escribe de forma síncrona al stream inyectado (buffer interno) --
// hace falta esperar flush() antes de leer lo capturado.
const captureLog = async (payload: Record<string, unknown>): Promise<string> => {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  // level: 'info' explícito -- LOG_LEVEL de test suele ser 'error' para
  // reducir ruido, y options.level lo hereda; sin este override el .info()
  // de abajo ni se escribiría, dando un falso positivo de "todo redactado".
  const testLogger = pino({ ...options, level: 'info' }, sink);
  testLogger.info(payload, 'evento de prueba');
  await new Promise<void>((resolve, reject) => {
    testLogger.flush((err) => (err ? reject(err) : resolve()));
  });
  return Buffer.concat(chunks).toString('utf8');
};

// Fase 5 (ADR-013): un campo agregado a COMMON_REDACT_PATHS
// (@clinica/audit-log) se prueba automáticamente acá en los 5 servicios,
// sin tocar este archivo -- si el catálogo compartido cambia, esta suite
// cambia con él.
describe('redacción de PII en logs (Fase 5, ADR-013)', () => {
  it.each(ROOT_FIELDS)('censura el campo raíz "%s"', async (field) => {
    const rawValue = `valor-secreto-${field}`;
    const output = await captureLog({ [field]: rawValue });

    expect(output).not.toContain(rawValue);
    expect(output).toContain(REDACT_CENSOR);
  });

  it.each(NESTED_FIELDS)('censura el campo anidado "%s" en cualquier profundidad', async (field) => {
    const rawValue = `valor-secreto-${field}`;
    const output = await captureLog({ context: { [field]: rawValue } });

    expect(output).not.toContain(rawValue);
    expect(output).toContain(REDACT_CENSOR);
  });

  it('no censura campos que no son PII', async () => {
    const output = await captureLog({ appointmentId: 'apt-1', status: 'CONFIRMED' });

    expect(output).toContain('apt-1');
    expect(output).toContain('CONFIRMED');
    expect(output).not.toContain(REDACT_CENSOR);
  });
});
