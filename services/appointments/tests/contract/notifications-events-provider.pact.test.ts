import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { Verifier } from '@pact-foundation/pact';
import { afterAll, describe, it } from 'vitest';

import { prisma } from '../../src/config/prisma.js';
import { buildStateMachine } from '../../src/modules/appointments/state-machine.js';
import { logger } from '../../src/lib/logger.js';
import { runWithTenant } from '../../src/lib/tenant-context.js';
import { withTenantId } from '../../src/lib/tenant-scoped.js';

const TEST_TENANT_ID = '88888888-8888-8888-8888-888888888888';

const PACT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'pacts',
  'notifications-appointments.json',
);

// Verificación del lado del provider para el pact de mensajes (PLAN.md
// Fase 4, punto 3b). A diferencia de un contrato HTTP, no hay servidor que
// pegarle: se ejecuta el código REAL que produce cada evento (la
// transacción que escribe en Outbox) contra Postgres real, y se devuelve
// el payload tal cual quedó persistido — eso es lo que Pact compara contra
// lo que Notifications dijo que necesitaba.
describe('Pact provider verification (mensajes): Appointments → Notifications', () => {
  const createdAppointmentIds: string[] = [];

  afterAll(async () => {
    if (createdAppointmentIds.length > 0) {
      await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
        tx.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } }),
      );
    }
    await prisma.$disconnect();
  });

  it('cumple el contrato definido por Notifications', async () => {
    const verifier = new Verifier({
      provider: 'appointments',
      providerBaseUrl: 'http://127.0.0.1:1', // no se usa para mensajes, pero el Verifier lo exige
      pactUrls: [PACT_FILE],
      messageProviders: {
        'un evento AppointmentCreated': async () => {
          const event = await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
            const patient = await tx.patient.create({
              data: {
                tenantId: TEST_TENANT_ID,
                email: `pact-provider-${randomUUID()}@example.com`,
                name: 'Paciente Pact Provider',
                phone: '+54 9 11 5555-9999',
              },
            });
            const appointment = await tx.appointment.create({
              data: {
                tenantId: TEST_TENANT_ID,
                patientId: patient.id,
                doctorId: randomUUID(),
                dateTime: new Date(Date.now() + 86_400_000),
                durationMinutes: 30,
              },
            });
            createdAppointmentIds.push(appointment.id);
            await tx.appointmentEvent.create({
              data: { tenantId: TEST_TENANT_ID, appointmentId: appointment.id, type: 'CREATED', payload: {} },
            });
            await tx.outboxEvent.create({
              data: {
                tenantId: TEST_TENANT_ID,
                type: 'AppointmentCreated',
                payload: {
                  appointmentId: appointment.id,
                  patientId: patient.id,
                  doctorId: appointment.doctorId,
                  dateTime: appointment.dateTime.toISOString(),
                },
              },
            });
            return tx.outboxEvent.findFirst({
              where: { type: 'AppointmentCreated' },
              orderBy: { createdAt: 'desc' },
            });
          });
          return event?.payload;
        },
        'un evento AppointmentStatusChanged': async () => {
          const appointment = await withTenantId(prisma, TEST_TENANT_ID, async (tx) => {
            const patient = await tx.patient.create({
              data: {
                tenantId: TEST_TENANT_ID,
                email: `pact-provider-${randomUUID()}@example.com`,
                name: 'Paciente Pact Provider 2',
                phone: '+54 9 11 5555-8888',
              },
            });
            return tx.appointment.create({
              data: {
                tenantId: TEST_TENANT_ID,
                patientId: patient.id,
                doctorId: randomUUID(),
                dateTime: new Date(Date.now() + 86_400_000),
                durationMinutes: 30,
                status: 'CONFIRMED',
                stripePaymentIntentId: `pi_${randomUUID()}`,
              },
            });
          });
          createdAppointmentIds.push(appointment.id);

          const stateMachine = buildStateMachine(prisma, logger);
          await runWithTenant(TEST_TENANT_ID, () =>
            stateMachine.transition(appointment.id, 'PAID', { trigger: 'webhook' }),
          );

          const event = await withTenantId(prisma, TEST_TENANT_ID, (tx) =>
            tx.outboxEvent.findFirst({
              where: { type: 'AppointmentStatusChanged' },
              orderBy: { createdAt: 'desc' },
            }),
          );
          return event?.payload;
        },
      },
    });

    await verifier.verifyProvider();
  });
});
