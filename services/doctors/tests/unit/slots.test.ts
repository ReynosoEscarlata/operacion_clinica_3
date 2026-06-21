import { describe, expect, it } from 'vitest';

import { generateSlotsForDate, parseTimeToMinutes, slotToIsoDateTime } from '../../src/lib/slots.js';

describe('parseTimeToMinutes', () => {
  it('convierte HH:MM a minutos desde medianoche', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });
});

describe('generateSlotsForDate', () => {
  it('genera bloques de 30 minutos dentro del rango de disponibilidad', () => {
    const slots = generateSlotsForDate([{ startTime: '09:00', endTime: '10:00' }]);

    expect(slots).toEqual([
      { startTime: '09:00', endTime: '09:30', available: true },
      { startTime: '09:30', endTime: '10:00', available: true },
    ]);
  });

  it('no genera un slot parcial si el bloque no es múltiplo de 30 minutos', () => {
    const slots = generateSlotsForDate([{ startTime: '09:00', endTime: '09:45' }]);

    expect(slots).toHaveLength(1);
  });

  it('combina varios bloques del mismo día', () => {
    const slots = generateSlotsForDate([
      { startTime: '09:00', endTime: '09:30' },
      { startTime: '14:00', endTime: '14:30' },
    ]);

    expect(slots).toHaveLength(2);
  });

  it('sin bloques de disponibilidad, no genera slots', () => {
    expect(generateSlotsForDate([])).toEqual([]);
  });
});

describe('slotToIsoDateTime', () => {
  it('combina year/month/day con un HH:MM en un ISO datetime válido', () => {
    const iso = slotToIsoDateTime(2026, 6, 20, '09:00');
    const parsed = new Date(iso);

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(5);
    expect(parsed.getDate()).toBe(20);
  });
});
