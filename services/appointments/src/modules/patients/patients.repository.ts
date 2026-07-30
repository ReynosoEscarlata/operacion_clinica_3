import type { Appointment, Patient, PrismaClient } from '@prisma/client';

import { writeOutboxEvent } from '../../lib/outbox.js';
import { getTenantId } from '../../lib/tenant-context.js';
import { withTenant } from '../../lib/tenant-scoped.js';

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

// Patient es dato privado por tenant (a diferencia del directorio de
// Doctors) -- TODO método pasa por withTenant. Para los flujos públicos
// (crear paciente, buscar por email al reservar), el caller ya resolvió el
// tenant desde el doctorId y entró en runWithTenant(...) antes de llegar
// aquí (ver patients.service.ts) -- este repositorio no sabe ni le importa
// de dónde vino el tenant, solo que debe existir en el AsyncLocalStorage.
export class PrismaPatientRepository implements PatientRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreatePatientData): Promise<Patient> {
    return withTenant(this.prisma, async (tx) => {
      const tenantId = getTenantId();
      if (!tenantId) {
        throw new Error('create() llamado sin tenant en contexto');
      }

      const patient = await tx.patient.create({ data: { ...data, tenantId } });

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
    return withTenant(this.prisma, (tx) => tx.patient.findFirst({ where: { email } }));
  }

  async findById(id: string): Promise<PatientWithAppointments | null> {
    return withTenant(this.prisma, (tx) =>
      tx.patient.findUnique({
        where: { id },
        include: { appointments: { orderBy: { dateTime: 'desc' } } },
      }),
    );
  }

  async update(id: string, data: UpdatePatientData): Promise<Patient | null> {
    return withTenant(this.prisma, async (tx) => {
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
    return withTenant(this.prisma, (tx) =>
      tx.patient.findMany({
        take: params.limit,
        ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
        orderBy: { createdAt: 'asc' },
      }),
    );
  }
}

export const buildPatientRepository = (prisma: PrismaClient): PatientRepository =>
  new PrismaPatientRepository(prisma);
