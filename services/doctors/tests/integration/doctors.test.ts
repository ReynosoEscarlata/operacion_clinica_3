import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';

// A propósito NO usa toISOString().slice(0,10): eso da la fecha en UTC, que
// puede ser un día distinto a la fecha LOCAL si el huso horario está
// suficientemente lejos de UTC (el mismo corrimiento de día que
// src/lib/slots.ts ya evita al construir Date con componentes locales).
const toLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

describe('Doctors CRUD + slots (integración con DB real)', () => {
  let app: FastifyInstance;
  let doctorId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (doctorId) {
      await prisma.availability.deleteMany({ where: { doctorId } });
      await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('crea un doctor con precio por especialidad y publica DoctorCreated', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/doctors',
      payload: { name: 'Dr. Test', email: `doctor-${randomUUID()}@example.com`, specialty: 'Cardiología' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.consultationPriceCents).toBe(80_000);
    doctorId = body.id;

    const events = await prisma.outboxEvent.findMany({ where: { type: 'DoctorCreated' } });
    const match = events.find((event) => (event.payload as { doctorId?: string }).doctorId === doctorId);
    expect(match).toBeDefined();
  });

  it('respeta un precio explícito por sobre el default de especialidad', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/doctors',
      payload: {
        name: 'Dr. Precio Custom',
        email: `doctor-${randomUUID()}@example.com`,
        specialty: 'Cardiología',
        consultationPriceCents: 99_000,
      },
    });

    expect(response.json().consultationPriceCents).toBe(99_000);
    await prisma.doctor.delete({ where: { id: response.json().id } });
  });

  it('retorna 404 al buscar un doctor inexistente', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/doctors/${randomUUID()}` });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('DOCTOR_NOT_FOUND');
  });

  it('agrega un bloque de disponibilidad y publica DoctorUpdated', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/doctors/${doctorId}/availability`,
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
    });

    expect(response.statusCode).toBe(201);

    const events = await prisma.outboxEvent.findMany({ where: { type: 'DoctorUpdated' } });
    const match = events.find((event) => (event.payload as { doctorId?: string }).doctorId === doctorId);
    expect(match).toBeDefined();
  });

  it('rechaza un bloque de disponibilidad inválido (startTime >= endTime)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/doctors/${doctorId}/availability`,
      payload: { dayOfWeek: 1, startTime: '12:00', endTime: '09:00' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_AVAILABILITY_BLOCK');
  });

  it('calcula los slots disponibles como ISO datetimes para el día configurado', async () => {
    const monday = new Date();
    monday.setDate(monday.getDate() + ((1 - monday.getDay() + 7) % 7 || 7));
    const dateStr = toLocalDateString(monday);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/doctors/${doctorId}/slots?date=${dateStr}`,
    });

    expect(response.statusCode).toBe(200);
    const { slots } = response.json();
    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
    expect(() => new Date(slots[0])).not.toThrow();
  });

  it('retorna slots vacíos para un día sin disponibilidad configurada', async () => {
    const tuesday = new Date();
    tuesday.setDate(tuesday.getDate() + ((2 - tuesday.getDay() + 7) % 7 || 7));
    const dateStr = toLocalDateString(tuesday);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/doctors/${doctorId}/slots?date=${dateStr}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().slots).toEqual([]);
  });

  it('rechaza una fecha pasada al pedir slots', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/doctors/${doctorId}/slots?date=2020-01-01`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('PAST_DATE');
  });

  it('lista doctores incluyendo el recién creado', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/doctors' });

    expect(response.statusCode).toBe(200);
    const ids = (response.json().data as Array<{ id: string }>).map((doctor) => doctor.id);
    expect(ids).toContain(doctorId);
  });
});
