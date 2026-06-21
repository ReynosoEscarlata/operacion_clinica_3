import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Verifier } from '@pact-foundation/pact';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';

const PACT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'pacts',
  'appointments-doctors.json',
);

const DOCTOR_EXISTS_ID = '11111111-1111-1111-1111-111111111111';
const DOCTOR_NOT_FOUND_ID = '22222222-2222-2222-2222-222222222222';
const DOCTOR_WITH_AVAILABILITY_ID = '33333333-3333-3333-3333-333333333333';
const FIXTURE_IDS = [DOCTOR_EXISTS_ID, DOCTOR_NOT_FOUND_ID, DOCTOR_WITH_AVAILABILITY_ID];

// Verificación del lado del provider (PLAN.md Fase 4, punto 3b): toma el
// pact ya generado por el consumer test de Appointments
// (services/appointments/tests/contract/doctors.pact.test.ts) y lo corre
// contra la app REAL de Doctors (no un mock) — cada interacción dispara su
// providerState, que acá se traduce en sembrar filas reales con el MISMO id
// que usó el consumer. El tipo de `stateHandlers` del Verifier (a
// diferencia del de Proxy) exige una función simple, sin {setup,teardown}
// — la limpieza de los fixtures se hace una sola vez en afterAll.
describe('Pact provider verification: Doctors', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('No se pudo obtener el puerto del servidor de prueba');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await prisma.doctor.deleteMany({ where: { id: { in: FIXTURE_IDS } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('cumple el contrato definido por Appointments', async () => {
    const verifier = new Verifier({
      provider: 'doctors',
      providerBaseUrl: baseUrl,
      pactUrls: [PACT_FILE],
      stateHandlers: {
        'el doctor existe': async () => {
          await prisma.doctor.upsert({
            where: { id: DOCTOR_EXISTS_ID },
            create: {
              id: DOCTOR_EXISTS_ID,
              name: 'Dra. Pact',
              email: 'pact-doctor@clinica.test',
              specialty: 'Medicina General',
              consultationPriceCents: 50_000,
            },
            update: { consultationPriceCents: 50_000 },
          });
          return undefined;
        },
        'el doctor no existe': async () => {
          await prisma.doctor.delete({ where: { id: DOCTOR_NOT_FOUND_ID } }).catch(() => undefined);
          return undefined;
        },
        'el doctor tiene disponibilidad configurada': async () => {
          await prisma.doctor.upsert({
            where: { id: DOCTOR_WITH_AVAILABILITY_ID },
            create: {
              id: DOCTOR_WITH_AVAILABILITY_ID,
              name: 'Dr. Pact Disponible',
              email: 'pact-doctor-2@clinica.test',
              specialty: 'Medicina General',
              consultationPriceCents: 50_000,
              // new Date(2026, 6, 1) (mes 0-indexado: julio) — mismo
              // criterio de fecha local que usa slots.ts al interpretar
              // "date=2026-07-01" (ver toLocalDateString en sus tests).
              availabilities: {
                create: [{ dayOfWeek: new Date(2026, 6, 1).getDay(), startTime: '09:00', endTime: '12:00' }],
              },
            },
            update: {},
          });
          return undefined;
        },
      },
    });

    await verifier.verifyProvider();
  });
});
