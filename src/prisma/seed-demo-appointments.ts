import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient, type AppointmentStatus, type EventType, type Prisma } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_IDS_FILE = path.join(__dirname, '.demo-appointment-ids.json');

// Script de datos demo para revisar el panel admin manualmente.
// No es parte del seed oficial (prisma/seed.ts) — se corre aparte con
// `npm run prisma:seed:demo` y asume que los doctores/pacientes del seed
// oficial ya existen.

const prisma = new PrismaClient();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface AppointmentSeedSpec {
  patientEmail: string;
  doctorName: string;
  dateTimeOffsetMs: number;
  durationMinutes: number;
  amountCents: number;
  status: AppointmentStatus;
  cancellationReason?: string;
  withPaymentIntent: boolean;
  events: Array<{ type: EventType; offsetMs: number; payload?: Prisma.InputJsonObject }>;
  timestamps?: Partial<{
    confirmedAt: number;
    paidAt: number;
    remindedAt: number;
    completedAt: number;
    cancelledAt: number;
    noShowAt: number;
  }>;
}

const APPOINTMENTS: AppointmentSeedSpec[] = [
  // PENDING: recién creada, esperando que el paciente pague (ventana muy corta en la vida real)
  {
    patientEmail: 'ana.torres@example.com',
    doctorName: 'Dra. Lucía Fernández',
    dateTimeOffsetMs: 3 * DAY_MS,
    durationMinutes: 30,
    amountCents: 0,
    status: 'PENDING',
    withPaymentIntent: false,
    events: [{ type: 'CREATED', offsetMs: -5 * 60_000 }],
  },

  // CONFIRMED: PaymentIntent creado, esperando el webhook de pago
  {
    patientEmail: 'bruno.diaz@example.com',
    doctorName: 'Dr. Martín Gómez',
    dateTimeOffsetMs: 4 * DAY_MS,
    durationMinutes: 30,
    amountCents: 60_000,
    status: 'CONFIRMED',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -10 * 60_000 },
    events: [
      { type: 'CREATED', offsetMs: -10 * 60_000 },
      { type: 'STATUS_CHANGED', offsetMs: -10 * 60_000, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
    ],
  },

  // PAID hoy (para que "ingresos del día" y "citas hoy" tengan datos)
  {
    patientEmail: 'carla.suarez@example.com',
    doctorName: 'Dra. Lucía Fernández',
    dateTimeOffsetMs: 6 * HOUR_MS,
    durationMinutes: 30,
    amountCents: 80_000,
    status: 'PAID',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -2 * HOUR_MS, paidAt: -2 * HOUR_MS + 60_000 },
    events: [
      { type: 'CREATED', offsetMs: -2 * HOUR_MS },
      { type: 'STATUS_CHANGED', offsetMs: -2 * HOUR_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -2 * HOUR_MS + 60_000, payload: { trigger: 'webhook' } },
      { type: 'EMAIL_SENT', offsetMs: -2 * HOUR_MS + 90_000, payload: { emailType: 'confirmation' } },
    ],
  },

  // PAID esta semana, dentro de 2 días
  {
    patientEmail: 'diego.morales@example.com',
    doctorName: 'Dr. Martín Gómez',
    dateTimeOffsetMs: 2 * DAY_MS,
    durationMinutes: 30,
    amountCents: 60_000,
    status: 'PAID',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -DAY_MS, paidAt: -DAY_MS + 60_000 },
    events: [
      { type: 'CREATED', offsetMs: -DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -DAY_MS + 60_000, payload: { trigger: 'webhook' } },
    ],
  },

  // PAID dentro de este mes, más lejos (>24h) — candidata a refund completo si se cancela
  {
    patientEmail: 'elena.castro@example.com',
    doctorName: 'Dra. Valentina Ríos',
    dateTimeOffsetMs: 20 * DAY_MS,
    durationMinutes: 30,
    amountCents: 50_000,
    status: 'PAID',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -3 * DAY_MS, paidAt: -3 * DAY_MS + 60_000 },
    events: [
      { type: 'CREATED', offsetMs: -3 * DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -3 * DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -3 * DAY_MS + 60_000, payload: { trigger: 'webhook' } },
    ],
  },

  // PAID muy próxima (<24h) — candidata a refund parcial (50%) si se cancela
  {
    patientEmail: 'ana.torres@example.com',
    doctorName: 'Dr. Martín Gómez',
    dateTimeOffsetMs: 10 * HOUR_MS,
    durationMinutes: 30,
    amountCents: 60_000,
    status: 'PAID',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -4 * DAY_MS, paidAt: -4 * DAY_MS + 60_000 },
    events: [
      { type: 'CREATED', offsetMs: -4 * DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -4 * DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -4 * DAY_MS + 60_000, payload: { trigger: 'webhook' } },
    ],
  },

  // REMINDED: ya se envió el recordatorio 24h antes
  {
    patientEmail: 'bruno.diaz@example.com',
    doctorName: 'Dra. Valentina Ríos',
    dateTimeOffsetMs: DAY_MS,
    durationMinutes: 30,
    amountCents: 50_000,
    status: 'REMINDED',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -6 * DAY_MS, paidAt: -6 * DAY_MS + 60_000, remindedAt: -2 * HOUR_MS },
    events: [
      { type: 'CREATED', offsetMs: -6 * DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -6 * DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -6 * DAY_MS + 60_000, payload: { trigger: 'webhook' } },
      { type: 'REMINDER_SENT', offsetMs: -2 * HOUR_MS, payload: { trigger: 'reminder-job' } },
    ],
  },

  // COMPLETED x2 con la misma doctora (para la tasa de no-show por doctor)
  {
    patientEmail: 'carla.suarez@example.com',
    doctorName: 'Dra. Lucía Fernández',
    dateTimeOffsetMs: -2 * DAY_MS,
    durationMinutes: 30,
    amountCents: 80_000,
    status: 'COMPLETED',
    withPaymentIntent: true,
    timestamps: {
      confirmedAt: -9 * DAY_MS,
      paidAt: -9 * DAY_MS + 60_000,
      remindedAt: -3 * DAY_MS,
      completedAt: -2 * DAY_MS + HOUR_MS,
    },
    events: [
      { type: 'CREATED', offsetMs: -9 * DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -9 * DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -9 * DAY_MS + 60_000, payload: { trigger: 'webhook' } },
      { type: 'REMINDER_SENT', offsetMs: -3 * DAY_MS, payload: { trigger: 'reminder-job' } },
      { type: 'STATUS_CHANGED', offsetMs: -2 * DAY_MS + HOUR_MS, payload: { from: 'REMINDED', to: 'COMPLETED', trigger: 'admin' } },
    ],
  },
  {
    patientEmail: 'diego.morales@example.com',
    doctorName: 'Dra. Lucía Fernández',
    dateTimeOffsetMs: -5 * DAY_MS,
    durationMinutes: 30,
    amountCents: 80_000,
    status: 'COMPLETED',
    withPaymentIntent: true,
    timestamps: {
      confirmedAt: -12 * DAY_MS,
      paidAt: -12 * DAY_MS + 60_000,
      remindedAt: -6 * DAY_MS,
      completedAt: -5 * DAY_MS + HOUR_MS,
    },
    events: [
      { type: 'CREATED', offsetMs: -12 * DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -12 * DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -12 * DAY_MS + 60_000, payload: { trigger: 'webhook' } },
      { type: 'REMINDER_SENT', offsetMs: -6 * DAY_MS, payload: { trigger: 'reminder-job' } },
      { type: 'STATUS_CHANGED', offsetMs: -5 * DAY_MS + HOUR_MS, payload: { from: 'REMINDED', to: 'COMPLETED', trigger: 'admin' } },
    ],
  },

  // NO_SHOW: marcado automáticamente por el cron, 1h después de la cita
  {
    patientEmail: 'elena.castro@example.com',
    doctorName: 'Dra. Lucía Fernández',
    dateTimeOffsetMs: -3 * DAY_MS,
    durationMinutes: 30,
    amountCents: 80_000,
    status: 'NO_SHOW',
    withPaymentIntent: true,
    timestamps: {
      confirmedAt: -10 * DAY_MS,
      paidAt: -10 * DAY_MS + 60_000,
      remindedAt: -4 * DAY_MS,
      noShowAt: -3 * DAY_MS + HOUR_MS,
    },
    events: [
      { type: 'CREATED', offsetMs: -10 * DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -10 * DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -10 * DAY_MS + 60_000, payload: { trigger: 'webhook' } },
      { type: 'REMINDER_SENT', offsetMs: -4 * DAY_MS, payload: { trigger: 'reminder-job' } },
      { type: 'STATUS_CHANGED', offsetMs: -3 * DAY_MS + HOUR_MS, payload: { from: 'REMINDED', to: 'NO_SHOW', trigger: 'noshow-cron' } },
    ],
  },

  // CANCELLED con refund completo (canceló con más de 24h de anticipación)
  {
    patientEmail: 'bruno.diaz@example.com',
    doctorName: 'Dr. Martín Gómez',
    dateTimeOffsetMs: 8 * DAY_MS,
    durationMinutes: 30,
    amountCents: 60_000,
    status: 'CANCELLED',
    cancellationReason: 'El paciente reprogramó por motivos personales',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -4 * DAY_MS, paidAt: -4 * DAY_MS + 60_000, cancelledAt: -DAY_MS },
    events: [
      { type: 'CREATED', offsetMs: -4 * DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -4 * DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -4 * DAY_MS + 60_000, payload: { trigger: 'webhook' } },
      {
        type: 'CANCELLED',
        offsetMs: -DAY_MS,
        payload: { from: 'PAID', to: 'CANCELLED', trigger: 'patient', refundAmountCents: 60_000, refundType: 'FULL', cancelledBy: 'PATIENT' },
      },
    ],
  },

  // CANCELLED con refund parcial (canceló con menos de 24h de anticipación)
  {
    patientEmail: 'ana.torres@example.com',
    doctorName: 'Dra. Valentina Ríos',
    dateTimeOffsetMs: -4 * HOUR_MS,
    durationMinutes: 30,
    amountCents: 50_000,
    status: 'CANCELLED',
    cancellationReason: 'Doctor no disponible por emergencia',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -7 * DAY_MS, paidAt: -7 * DAY_MS + 60_000, cancelledAt: -5 * HOUR_MS },
    events: [
      { type: 'CREATED', offsetMs: -7 * DAY_MS },
      { type: 'STATUS_CHANGED', offsetMs: -7 * DAY_MS, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_RECEIVED', offsetMs: -7 * DAY_MS + 60_000, payload: { trigger: 'webhook' } },
      {
        type: 'CANCELLED',
        offsetMs: -5 * HOUR_MS,
        payload: { from: 'PAID', to: 'CANCELLED', trigger: 'admin', refundAmountCents: 25_000, refundType: 'PARTIAL', cancelledBy: 'ADMIN' },
      },
    ],
  },

  // PAYMENT_FAILED registrado sobre una cita que sigue CONFIRMED (el paciente puede reintentar)
  {
    patientEmail: 'carla.suarez@example.com',
    doctorName: 'Dr. Martín Gómez',
    dateTimeOffsetMs: 5 * DAY_MS,
    durationMinutes: 30,
    amountCents: 60_000,
    status: 'CONFIRMED',
    withPaymentIntent: true,
    timestamps: { confirmedAt: -30 * 60_000 },
    events: [
      { type: 'CREATED', offsetMs: -30 * 60_000 },
      { type: 'STATUS_CHANGED', offsetMs: -30 * 60_000, payload: { from: 'PENDING', to: 'CONFIRMED', trigger: 'system' } },
      { type: 'PAYMENT_FAILED', offsetMs: -10 * 60_000, payload: { lastPaymentError: 'Tarjeta rechazada por fondos insuficientes' } },
      { type: 'EMAIL_SENT', offsetMs: -9 * 60_000, payload: { emailType: 'payment-failed' } },
    ],
  },
];

const main = async (): Promise<void> => {
  const doctors = await prisma.doctor.findMany();
  const patients = await prisma.patient.findMany();

  const doctorByName = new Map(doctors.map((doctor) => [doctor.name, doctor]));
  const patientByEmail = new Map(patients.map((patient) => [patient.email, patient]));

  const now = Date.now();
  const createdIds: string[] = [];

  for (const spec of APPOINTMENTS) {
    const doctor = doctorByName.get(spec.doctorName);
    const patient = patientByEmail.get(spec.patientEmail);

    if (!doctor || !patient) {
      // eslint-disable-next-line no-console
      console.warn(`Saltando spec: no se encontró doctor "${spec.doctorName}" o paciente "${spec.patientEmail}". Corré el seed oficial primero.`);
      continue;
    }

    const dateTime = new Date(now + spec.dateTimeOffsetMs);
    const stripePaymentIntentId = spec.withPaymentIntent ? `pi_demo_${randomUUID()}` : null;

    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        dateTime,
        durationMinutes: spec.durationMinutes,
        amountCents: spec.amountCents,
        status: spec.status,
        cancellationReason: spec.cancellationReason ?? null,
        stripePaymentIntentId,
        ...(spec.timestamps?.confirmedAt !== undefined ? { confirmedAt: new Date(now + spec.timestamps.confirmedAt) } : {}),
        ...(spec.timestamps?.paidAt !== undefined ? { paidAt: new Date(now + spec.timestamps.paidAt) } : {}),
        ...(spec.timestamps?.remindedAt !== undefined ? { remindedAt: new Date(now + spec.timestamps.remindedAt) } : {}),
        ...(spec.timestamps?.completedAt !== undefined ? { completedAt: new Date(now + spec.timestamps.completedAt) } : {}),
        ...(spec.timestamps?.cancelledAt !== undefined ? { cancelledAt: new Date(now + spec.timestamps.cancelledAt) } : {}),
        ...(spec.timestamps?.noShowAt !== undefined ? { noShowAt: new Date(now + spec.timestamps.noShowAt) } : {}),
      },
    });

    createdIds.push(appointment.id);

    for (const event of spec.events) {
      await prisma.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          type: event.type,
          payload: event.payload ?? {},
          createdAt: new Date(now + event.offsetMs),
        },
      });
    }
  }

  await writeFile(DEMO_IDS_FILE, JSON.stringify(createdIds, null, 2));

  // eslint-disable-next-line no-console
  console.log(`Listo: ${createdIds.length} citas demo creadas.`);
  // eslint-disable-next-line no-console
  console.log('Para borrarlas: npm run prisma:seed:demo:clean');
};

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Error al ejecutar el seed demo:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
