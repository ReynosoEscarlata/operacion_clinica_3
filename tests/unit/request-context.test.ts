import { describe, expect, it } from 'vitest';

import { getRequestId, requestContextStorage } from '../../src/lib/request-context.js';

describe('requestContextStorage', () => {
  it('expone el requestId dentro del callback de run()', async () => {
    expect(getRequestId()).toBeUndefined();

    await requestContextStorage.run({ requestId: 'req-123' }, async () => {
      expect(getRequestId()).toBe('req-123');

      // Simula propagación a través de capas async (service -> repository)
      await Promise.resolve();
      expect(getRequestId()).toBe('req-123');
    });

    expect(getRequestId()).toBeUndefined();
  });

  it('aísla el contexto entre ejecuciones concurrentes', async () => {
    const results = await Promise.all([
      requestContextStorage.run({ requestId: 'req-a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getRequestId();
      }),
      requestContextStorage.run({ requestId: 'req-b' }, async () => {
        return getRequestId();
      }),
    ]);

    expect(results).toEqual(['req-a', 'req-b']);
  });

  it('enterWith() mantiene el contexto para el resto de la ejecución asíncrona actual', async () => {
    const run = async (): Promise<string | undefined> => {
      requestContextStorage.enterWith({ requestId: 'req-enter-with' });
      await Promise.resolve();
      return getRequestId();
    };

    expect(await run()).toBe('req-enter-with');
  });
});
