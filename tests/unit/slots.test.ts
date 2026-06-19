import { describe, expect, it } from 'vitest';

import { generateSlotsForDate } from '../../src/modules/doctors/slots.js';

describe('generateSlotsForDate', () => {
  it('genera slots de 30 minutos para un bloque de disponibilidad, todos disponibles sin citas', () => {
    const slots = generateSlotsForDate(2026, 6, 22, [{ startTime: '09:00', endTime: '10:00' }], []);

    expect(slots).toEqual([
      { startTime: '09:00', endTime: '09:30', available: true },
      { startTime: '09:30', endTime: '10:00', available: true },
    ]);
  });

  it('marca como no disponible el slot que se cruza con una cita existente', () => {
    const slots = generateSlotsForDate(
      2026,
      6,
      22,
      [{ startTime: '09:00', endTime: '10:00' }],
      [{ start: new Date(2026, 5, 22, 9, 0), end: new Date(2026, 5, 22, 9, 30) }],
    );

    expect(slots).toEqual([
      { startTime: '09:00', endTime: '09:30', available: false },
      { startTime: '09:30', endTime: '10:00', available: true },
    ]);
  });

  it('combina varios bloques de disponibilidad del mismo día', () => {
    const slots = generateSlotsForDate(
      2026,
      6,
      22,
      [
        { startTime: '09:00', endTime: '09:30' },
        { startTime: '14:00', endTime: '15:00' },
      ],
      [],
    );

    expect(slots).toEqual([
      { startTime: '09:00', endTime: '09:30', available: true },
      { startTime: '14:00', endTime: '14:30', available: true },
      { startTime: '14:30', endTime: '15:00', available: true },
    ]);
  });

  it('descarta el resto de un bloque que no es múltiplo exacto de 30 minutos', () => {
    const slots = generateSlotsForDate(2026, 6, 22, [{ startTime: '09:00', endTime: '09:45' }], []);

    expect(slots).toEqual([{ startTime: '09:00', endTime: '09:30', available: true }]);
  });

  it('retorna un arreglo vacío cuando no hay bloques de disponibilidad', () => {
    const slots = generateSlotsForDate(2026, 6, 22, [], []);

    expect(slots).toEqual([]);
  });

  it('una cita que abarca dos slots los marca a ambos como no disponibles', () => {
    const slots = generateSlotsForDate(
      2026,
      6,
      22,
      [{ startTime: '09:00', endTime: '10:00' }],
      [{ start: new Date(2026, 5, 22, 9, 0), end: new Date(2026, 5, 22, 10, 0) }],
    );

    expect(slots.every((slot) => !slot.available)).toBe(true);
  });
});
