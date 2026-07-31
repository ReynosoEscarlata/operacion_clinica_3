import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';

// RFC-004: payment:refund es exclusivo de clinic_owner/platform_admin.
// allowAnonymous (ver payments.routes.ts) deja pasar el caso real de hoy
// (appointments llamando servicio-a-servicio, sin actor) pero NO debe
// abrir la puerta a cualquier rol autenticado que sí traiga un header --
// este test prueba justamente esa rama: con un actor presente pero sin el
// permiso, sigue siendo 403.
describe('RFC-004: requirePermission en /v1/refunds con un actor autenticado sin el permiso', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('receptionist (permiso "none" en la matriz) recibe 403 FORBIDDEN', async () => {
    app = await buildApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/refunds',
      headers: { 'x-internal-user-role': 'receptionist' },
      payload: { paymentIntentId: 'pi_fake', amountCents: 1000, appointmentId: '11111111-1111-1111-1111-111111111111' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });
});
