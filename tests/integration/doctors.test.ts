import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { redis } from '../../src/config/redis.js';

const getNextWeekdayDateString = (targetDayOfWeek: number): string => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() !== targetDayOfWeek);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

describe('Doctors CRUD + slots (integración con DB real)', () => {
  let app: FastifyInstance;
  let doctorId: string;
  let patientId: string;
  const nextMonday = getNextWeekdayDateString(1);

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (doctorId) {
      await prisma.appointment.deleteMany({ where: { doctorId } });
      await prisma.availability.deleteMany({ where: { doctorId } });
      await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    }
    if (patientId) {
      await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    }
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('crea un doctor', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/doctors',
      payload: {
        name: 'Dr. Integración',
        email: `doctor-${randomUUID()}@example.com`,
        specialty: 'Test',
      },
    });

    expect(response.statusCode).toBe(201);
    doctorId = response.json().id;
  });

  it('define la disponibilidad del doctor', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/doctors/${doctorId}/availability`,
      payload: { availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  it('rechaza disponibilidad con startTime mayor o igual a endTime', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/doctors/${doctorId}/availability`,
      payload: { availability: [{ dayOfWeek: 1, startTime: '10:00', endTime: '09:00' }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_AVAILABILITY_BLOCK');
  });

  it('obtiene el doctor con su disponibilidad', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/doctors/${doctorId}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().availabilities).toHaveLength(1);
  });

  it('lista todos los doctores e incluye el creado', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/doctors' });

    expect(response.statusCode).toBe(200);
    const ids = (response.json() as Array<{ id: string }>).map((doctor) => doctor.id);
    expect(ids).toContain(doctorId);
  });

  it('calcula slots disponibles sin citas existentes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/doctors/${doctorId}/slots?date=${nextMonday}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { startTime: '09:00', endTime: '09:30', available: true },
      { startTime: '09:30', endTime: '10:00', available: true },
    ]);
  });

  it('marca como no disponible el slot ocupado por una cita existente', async () => {
    const [year, month, day] = nextMonday.split('-').map(Number) as [number, number, number];

    const patient = await prisma.patient.create({
      data: {
        email: `slot-patient-${randomUUID()}@example.com`,
        name: 'Paciente de prueba',
        phone: '+54 9 11 5555-1111',
      },
    });
    patientId = patient.id;

    await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        dateTime: new Date(year, month - 1, day, 9, 0),
        durationMinutes: 30,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/doctors/${doctorId}/slots?date=${nextMonday}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { startTime: '09:00', endTime: '09:30', available: false },
      { startTime: '09:30', endTime: '10:00', available: true },
    ]);
  });

  it('retorna 400 con PAST_DATE al pedir slots para una fecha pasada', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/doctors/${doctorId}/slots?date=2020-01-01`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('PAST_DATE');
  });

  it('retorna 404 al pedir slots de un doctor inexistente', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/doctors/00000000-0000-0000-0000-000000000000/slots?date=${nextMonday}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('DOCTOR_NOT_FOUND');
  });
});
