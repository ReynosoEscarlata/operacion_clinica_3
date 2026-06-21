import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';

describe('Users CRUD (integración con DB real)', () => {
  let app: FastifyInstance;
  const testEmail = `staff-${randomUUID()}@clinica.test`;
  let createdId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (createdId) {
      await prisma.user.delete({ where: { id: createdId } }).catch(() => undefined);
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('crea un usuario Admin/Staff sin exponer el passwordHash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: testEmail, name: 'Staff de Prueba', role: 'STAFF', password: 'super-secreta' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.email).toBe(testEmail);
    expect(body.passwordHash).toBeUndefined();
    createdId = body.id;
  });

  it('registra el evento UserCreated en el Outbox (ADR-002)', async () => {
    const events = await prisma.outboxEvent.findMany({ where: { type: 'UserCreated' } });
    const match = events.find(
      (event) => (event.payload as { userId?: string }).userId === createdId,
    );
    expect(match).toBeDefined();
    expect(match?.publishedAt).toBeNull();
  });

  it('rechaza crear un usuario con email duplicado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { email: testEmail, name: 'Otro', role: 'ADMIN', password: 'super-secreta' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('USER_EMAIL_TAKEN');
  });

  it('lista usuarios incluyendo el recién creado', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users' });

    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.some((user: { id: string }) => user.id === createdId)).toBe(true);
  });

  it('desactiva el usuario y registra UserDeactivated', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${createdId}/deactivate`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().active).toBe(false);

    const events = await prisma.outboxEvent.findMany({ where: { type: 'UserDeactivated' } });
    const match = events.find(
      (event) => (event.payload as { userId?: string }).userId === createdId,
    );
    expect(match).toBeDefined();
  });

  it('desactivar un usuario ya desactivado es idempotente', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${createdId}/deactivate`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().active).toBe(false);
  });

  it('retorna 404 al desactivar un usuario inexistente', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${randomUUID()}/deactivate`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
  });
});
