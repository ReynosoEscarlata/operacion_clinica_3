import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/lib/password.js';

describe('password hashing', () => {
  it('verifica correctamente un password contra su hash', async () => {
    const hash = await hashPassword('correcto-123');
    await expect(verifyPassword('correcto-123', hash)).resolves.toBe(true);
  });

  it('rechaza un password incorrecto', async () => {
    const hash = await hashPassword('correcto-123');
    await expect(verifyPassword('incorrecto', hash)).resolves.toBe(false);
  });

  it('nunca guarda el password en texto plano', async () => {
    const hash = await hashPassword('correcto-123');
    expect(hash).not.toBe('correcto-123');
  });
});
