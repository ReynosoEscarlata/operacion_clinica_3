import type { AppointmentSnapshot, DoctorSnapshot, PatientSnapshot, PrismaClient } from '@prisma/client';

import { getTenantId } from '../../lib/tenant-context.js';
import { withTenant } from '../../lib/tenant-scoped.js';

export interface UpsertAppointmentData {
  id: string;
  patientId: string;
  doctorId: string;
  dateTime: Date;
  amountCents: number;
  status: string;
}

export interface UpsertPatientData {
  id: string;
  email: string;
  name: string;
}

export interface UpsertDoctorData {
  id: string;
  name: string;
  specialty: string;
}

export interface SnapshotsRepository {
  upsertAppointment: (data: UpsertAppointmentData) => Promise<AppointmentSnapshot>;
  updateAppointmentStatus: (id: string, status: string) => Promise<AppointmentSnapshot | null>;
  getAppointment: (id: string) => Promise<AppointmentSnapshot | null>;
  upsertPatient: (data: UpsertPatientData) => Promise<PatientSnapshot>;
  getPatient: (id: string) => Promise<PatientSnapshot | null>;
  upsertDoctor: (data: UpsertDoctorData) => Promise<DoctorSnapshot>;
  getDoctor: (id: string) => Promise<DoctorSnapshot | null>;
}

const requireTenantId = (operation: string): string => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error(`${operation}() llamado sin tenant en contexto`);
  }
  return tenantId;
};

export class PrismaSnapshotsRepository implements SnapshotsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertAppointment(data: UpsertAppointmentData): Promise<AppointmentSnapshot> {
    const tenantId = requireTenantId('upsertAppointment');
    return withTenant(this.prisma, (tx) =>
      tx.appointmentSnapshot.upsert({
        where: { id: data.id },
        create: { ...data, tenantId },
        update: data,
      }),
    );
  }

  async updateAppointmentStatus(id: string, status: string): Promise<AppointmentSnapshot | null> {
    try {
      return await withTenant(this.prisma, (tx) => tx.appointmentSnapshot.update({ where: { id }, data: { status } }));
    } catch {
      // P2025: no existe el snapshot todavía (AppointmentCreated no se
      // procesó aún, posible reordenamiento) — el caller decide qué hacer
      // (típicamente reintentar más tarde, no es un error permanente).
      return null;
    }
  }

  async getAppointment(id: string): Promise<AppointmentSnapshot | null> {
    return withTenant(this.prisma, (tx) => tx.appointmentSnapshot.findUnique({ where: { id } }));
  }

  async upsertPatient(data: UpsertPatientData): Promise<PatientSnapshot> {
    const tenantId = requireTenantId('upsertPatient');
    return withTenant(this.prisma, (tx) =>
      tx.patientSnapshot.upsert({ where: { id: data.id }, create: { ...data, tenantId }, update: data }),
    );
  }

  async getPatient(id: string): Promise<PatientSnapshot | null> {
    return withTenant(this.prisma, (tx) => tx.patientSnapshot.findUnique({ where: { id } }));
  }

  async upsertDoctor(data: UpsertDoctorData): Promise<DoctorSnapshot> {
    const tenantId = requireTenantId('upsertDoctor');
    return withTenant(this.prisma, (tx) =>
      tx.doctorSnapshot.upsert({
        where: { id: data.id },
        create: { ...data, tenantId },
        update: data,
      }),
    );
  }

  async getDoctor(id: string): Promise<DoctorSnapshot | null> {
    return withTenant(this.prisma, (tx) => tx.doctorSnapshot.findUnique({ where: { id } }));
  }
}

export const buildSnapshotsRepository = (prisma: PrismaClient): SnapshotsRepository =>
  new PrismaSnapshotsRepository(prisma);
