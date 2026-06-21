import type { Appointment, Patient, PrismaClient } from '@prisma/client';

import { writeOutboxEvent } from '../../lib/outbox.js';

export interface CreatePatientData {
  email: string;
  name: string;
  phone: string;
  stripeCustomerId: string | null;
}

export interface UpdatePatientData {
  name?: string;
  phone?: string;
}

export interface ListPatientsParams {
  cursor?: string;
  limit: number;
}

export type PatientWithAppointments = Patient & { appointments: Appointment[] };

export interface PatientRepository {
  create: (data: CreatePatientData) => Promise<Patient>;
  findByEmail: (email: string) => Promise<Patient | null>;
  findById: (id: string) => Promise<PatientWithAppointments | null>;
  update: (id: string, data: UpdatePatientData) => Promise<Patient | null>;
  list: (params: ListPatientsParams) => Promise<Patient[]>;
}

export class PrismaPatientRepository implements PatientRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreatePatientData): Promise<Patient> {
    return this.prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({ data });

      // Se reusa el tipo PatientUpdated también para la creación: para un
      // consumer de read-model (Notifications, RFC-001 decisión 4) crear y
      // actualizar son la misma operación de upsert por id — no se modeló
      // un PatientCreated separado para no multiplicar tipos de evento sin
      // necesidad real.
      await writeOutboxEvent(tx, 'PatientUpdated', {
        patientId: patient.id,
        email: patient.email,
        name: patient.name,
      });

      return patient;
    });
  }

  async findByEmail(email: string): Promise<Patient | null> {
    return this.prisma.patient.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<PatientWithAppointments | null> {
    return this.prisma.patient.findUnique({
      where: { id },
      include: { appointments: { orderBy: { dateTime: 'desc' } } },
    });
  }

  async update(id: string, data: UpdatePatientData): Promise<Patient | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.patient.findUnique({ where: { id } });
      if (!existing) {
        return null;
      }

      const patient = await tx.patient.update({ where: { id }, data });

      // PatientUpdated: consumido por Notifications para mantener su
      // read-model propio (RFC-001 decisión 4).
      await writeOutboxEvent(tx, 'PatientUpdated', {
        patientId: patient.id,
        email: patient.email,
        name: patient.name,
      });

      return patient;
    });
  }

  async list(params: ListPatientsParams): Promise<Patient[]> {
    return this.prisma.patient.findMany({
      take: params.limit,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
      orderBy: { createdAt: 'asc' },
    });
  }
}

export const buildPatientRepository = (prisma: PrismaClient): PatientRepository =>
  new PrismaPatientRepository(prisma);
