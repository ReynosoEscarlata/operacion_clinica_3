import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';

import { buildHttpDoctorsClient } from '../../src/clients/doctors-client.js';

const { like, integer, uuid } = MatchersV3;

// Contract entre Appointments (consumer) y Doctors (provider) — PLAN.md
// Fase 4, punto 3b. Sin Pact Broker (no se justifica para 5 servicios):
// el .json generado acá se commitea en pacts/ y la verificación del lado
// de Doctors (services/doctors/tests/contract/doctors-provider.pact.test.ts)
// lo lee de ahí y lo corre contra su app real. Si DoctorsClient cambia lo
// que espera, este test cambia y el archivo se regenera — si Doctors deja
// de cumplirlo, el test de verificación del otro lado lo va a agarrar.
const PACTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'pacts');

describe('Pact: Appointments (consumer) ↔ Doctors (provider)', () => {
  const pact = new PactV3({
    consumer: 'appointments',
    provider: 'doctors',
    dir: PACTS_DIR,
  });

  it('GET /v1/doctors/:id devuelve los datos básicos del doctor', async () => {
    const doctorId = '11111111-1111-1111-1111-111111111111';

    pact
      .given('el doctor existe')
      .uponReceiving('una consulta de datos básicos de un doctor')
      .withRequest({ method: 'GET', path: `/v1/doctors/${doctorId}` })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { id: uuid(doctorId), consultationPriceCents: integer(50_000) },
      });

    await pact.executeTest(async (mockServer) => {
      const client = buildHttpDoctorsClient(mockServer.url);
      const doctor = await client.getDoctor(doctorId);
      expect(doctor).toEqual({ id: doctorId, consultationPriceCents: 50_000 });
    });
  });

  it('GET /v1/doctors/:id devuelve 404 cuando el doctor no existe', async () => {
    const doctorId = '22222222-2222-2222-2222-222222222222';

    pact
      .given('el doctor no existe')
      .uponReceiving('una consulta de un doctor inexistente')
      .withRequest({ method: 'GET', path: `/v1/doctors/${doctorId}` })
      .willRespondWith({ status: 404 });

    await pact.executeTest(async (mockServer) => {
      const client = buildHttpDoctorsClient(mockServer.url);
      const doctor = await client.getDoctor(doctorId);
      expect(doctor).toBeNull();
    });
  });

  it('GET /v1/doctors/:id/slots devuelve los horarios disponibles para una fecha', async () => {
    const doctorId = '33333333-3333-3333-3333-333333333333';

    pact
      .given('el doctor tiene disponibilidad configurada')
      .uponReceiving('una consulta de horarios disponibles')
      .withRequest({
        method: 'GET',
        path: `/v1/doctors/${doctorId}/slots`,
        query: { date: '2026-07-01' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { slots: like(['2026-07-01T09:00:00.000Z', '2026-07-01T09:30:00.000Z']) },
      });

    await pact.executeTest(async (mockServer) => {
      const client = buildHttpDoctorsClient(mockServer.url);
      const slots = await client.getAvailableSlots(doctorId, '2026-07-01');
      expect(slots.length).toBeGreaterThan(0);
    });
  });
});
