import { describe, expect, it, vi } from 'vitest';

import { buildWithIdempotency, type IdempotencyStore } from '../../src/lib/idempotency.js';

const buildFakeStore = (): IdempotencyStore => ({
  findRecord: vi.fn().mockResolvedValue(null),
  saveRecord: vi.fn().mockResolvedValue(undefined),
});

describe('withIdempotency', () => {
  it('ejecuta fn y guarda el resultado cuando no hay registro previo', async () => {
    const store = buildFakeStore();
    const withIdempotency = buildWithIdempotency(store);
    const fn = vi.fn().mockResolvedValue({ ok: true });

    const result = await withIdempotency('key-1', fn);

    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.saveRecord).toHaveBeenCalledWith('key-1', { ok: true });
  });

  it('retorna el response cacheado sin ejecutar fn si la key ya existe y no expiró', async () => {
    const store: IdempotencyStore = {
      findRecord: vi.fn().mockResolvedValue({ response: { ok: 'cached' }, createdAt: new Date() }),
      saveRecord: vi.fn(),
    };
    const withIdempotency = buildWithIdempotency(store);
    const fn = vi.fn().mockResolvedValue({ ok: 'fresh' });

    const result = await withIdempotency('key-2', fn);

    expect(result).toEqual({ ok: 'cached' });
    expect(fn).not.toHaveBeenCalled();
    expect(store.saveRecord).not.toHaveBeenCalled();
  });

  it('ignora un registro expirado (>24h) y vuelve a ejecutar fn', async () => {
    const expiredDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const store: IdempotencyStore = {
      findRecord: vi.fn().mockResolvedValue({ response: { ok: 'stale' }, createdAt: expiredDate }),
      saveRecord: vi.fn().mockResolvedValue(undefined),
    };
    const withIdempotency = buildWithIdempotency(store);
    const fn = vi.fn().mockResolvedValue({ ok: 'fresh' });

    const result = await withIdempotency('key-3', fn);

    expect(result).toEqual({ ok: 'fresh' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.saveRecord).toHaveBeenCalledWith('key-3', { ok: 'fresh' });
  });
});
