import { describe, expect, it, vi } from 'vitest';

import { checkDatabase, checkRedis } from '../../src/lib/health-check.js';

describe('checkDatabase', () => {
  it('retorna "ok" cuando la query resuelve', async () => {
    const client = { $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]) };
    const logger = { error: vi.fn() };

    await expect(checkDatabase(client, logger)).resolves.toBe('ok');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('retorna "error" y loguea con contexto cuando la query falla', async () => {
    const error = new Error('conexión rechazada');
    const client = { $queryRaw: vi.fn().mockRejectedValue(error) };
    const logger = { error: vi.fn() };

    await expect(checkDatabase(client, logger)).resolves.toBe('error');
    expect(logger.error).toHaveBeenCalledWith({ err: error }, expect.any(String));
  });
});

describe('checkRedis', () => {
  it('retorna "ok" cuando el ping responde', async () => {
    const client = { ping: vi.fn().mockResolvedValue('PONG') };
    const logger = { error: vi.fn() };

    await expect(checkRedis(client, logger)).resolves.toBe('ok');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('retorna "error" y loguea con contexto cuando el ping falla', async () => {
    const error = new Error('ECONNREFUSED');
    const client = { ping: vi.fn().mockRejectedValue(error) };
    const logger = { error: vi.fn() };

    await expect(checkRedis(client, logger)).resolves.toBe('error');
    expect(logger.error).toHaveBeenCalledWith({ err: error }, expect.any(String));
  });
});
