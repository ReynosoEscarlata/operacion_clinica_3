import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type { AuthActor } from '../src/actor.js';
import { registerAuthzEnforcement, requirePermission } from '../src/require-permission.js';

describe('registerAuthzEnforcement: fail-closed', () => {
  it('lanza al registrar una ruta /v1/* sin config.authz', async () => {
    const app = Fastify();
    registerAuthzEnforcement(app);

    expect(() => {
      app.get('/v1/whatever', async () => ({ ok: true }));
    }).toThrow(/no declara config\.authz/);
  });

  it('no exige config.authz en rutas fuera de /v1/* (health, metrics)', async () => {
    const app = Fastify();
    registerAuthzEnforcement(app);

    expect(() => {
      app.get('/health', async () => ({ ok: true }));
    }).not.toThrow();
  });

  it('acepta una ruta /v1/* que declara config.authz.public', async () => {
    const app = Fastify();
    registerAuthzEnforcement(app);

    expect(() => {
      app.get('/v1/public-thing', { config: { authz: { public: true } } }, async () => ({ ok: true }));
    }).not.toThrow();
  });

  it('acepta una ruta /v1/* que declara config.authz.permission', async () => {
    const app = Fastify();
    registerAuthzEnforcement(app);

    expect(() => {
      app.get(
        '/v1/protected-thing',
        { config: { authz: { permission: 'audit:read' } }, preHandler: requirePermission('audit:read') },
        async () => ({ ok: true }),
      );
    }).not.toThrow();
  });
});

describe('requirePermission: enforcement en runtime', () => {
  const buildApp = () => {
    const app = Fastify();
    app.decorateRequest('authActor', undefined);
    app.addHook('onRequest', async (request) => {
      const header = request.headers['x-test-actor'];
      if (typeof header === 'string') {
        request.authActor = JSON.parse(header) as AuthActor;
      }
    });
    app.get(
      '/v1/audit',
      { preHandler: requirePermission('audit:read') },
      async () => ({ ok: true }),
    );
    return app;
  };

  it('responde 403 sin authActor', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/audit' });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('responde 403 con un rol sin el permiso', async () => {
    const app = buildApp();
    const actor: AuthActor = { sub: 'user-1', role: 'doctor', tenantId: 'tenant-a', doctorId: 'doctor-a' };
    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { 'x-test-actor': JSON.stringify(actor) },
    });
    expect(response.statusCode).toBe(403);
  });

  it('responde 200 con un rol que tiene el permiso', async () => {
    const app = buildApp();
    const actor: AuthActor = { sub: 'user-1', role: 'platform_admin', tenantId: null, doctorId: null };
    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: { 'x-test-actor': JSON.stringify(actor) },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('requirePermission: allowAnonymous (RFC-004, paciente sin cuenta)', () => {
  const buildApp = () => {
    const app = Fastify();
    app.decorateRequest('authActor', undefined);
    app.addHook('onRequest', async (request) => {
      const header = request.headers['x-test-actor'];
      if (typeof header === 'string') {
        request.authActor = JSON.parse(header) as AuthActor;
      }
    });
    // appointment:create: doctor tiene 'none' en la matriz -- allowAnonymous
    // deja pasar al paciente sin cuenta (sin authActor) pero sigue
    // excluyendo a un doctor autenticado, a diferencia de config.authz.public.
    app.get(
      '/v1/appointments-like',
      { preHandler: requirePermission('appointment:create', { allowAnonymous: true }) },
      async () => ({ ok: true }),
    );
    return app;
  };

  it('sin authActor (paciente sin cuenta) pasa', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/appointments-like' });
    expect(response.statusCode).toBe(200);
  });

  it('con un doctor autenticado (permiso "none" en la matriz) sigue rechazando', async () => {
    const app = buildApp();
    const actor: AuthActor = { sub: 'user-1', role: 'doctor', tenantId: 'tenant-a', doctorId: 'doctor-a' };
    const response = await app.inject({
      method: 'GET',
      url: '/v1/appointments-like',
      headers: { 'x-test-actor': JSON.stringify(actor) },
    });
    expect(response.statusCode).toBe(403);
  });

  it('con receptionist autenticado (permiso "all" en la matriz) pasa', async () => {
    const app = buildApp();
    const actor: AuthActor = { sub: 'user-1', role: 'receptionist', tenantId: 'tenant-a', doctorId: null };
    const response = await app.inject({
      method: 'GET',
      url: '/v1/appointments-like',
      headers: { 'x-test-actor': JSON.stringify(actor) },
    });
    expect(response.statusCode).toBe(200);
  });
});
