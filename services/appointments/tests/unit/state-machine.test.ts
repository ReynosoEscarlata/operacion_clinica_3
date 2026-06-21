import { describe, expect, it } from 'vitest';

import { canTransition } from '../../src/modules/appointments/state-machine.js';

describe('canTransition', () => {
  it.each([
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'CANCELLED'],
    ['CONFIRMED', 'PAID'],
    ['CONFIRMED', 'CANCELLED'],
    ['PAID', 'REMINDED'],
    ['PAID', 'CANCELLED'],
    ['PAID', 'COMPLETED'],
    ['REMINDED', 'COMPLETED'],
    ['REMINDED', 'CANCELLED'],
    ['REMINDED', 'NO_SHOW'],
  ] as const)('permite la transición %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['COMPLETED', 'PENDING'],
    ['CANCELLED', 'PAID'],
    ['NO_SHOW', 'REMINDED'],
    ['PAID', 'PENDING'],
    ['PENDING', 'PAID'],
    ['CONFIRMED', 'REMINDED'],
    ['CONFIRMED', 'NO_SHOW'],
  ] as const)('rechaza la transición inválida %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)(
    '%s es un estado final sin transiciones salientes',
    (status) => {
      expect(canTransition(status, 'PENDING')).toBe(false);
      expect(canTransition(status, 'CONFIRMED')).toBe(false);
    },
  );
});
