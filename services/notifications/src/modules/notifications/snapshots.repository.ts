import type { AppointmentSnapshot, DoctorSnapshot, PatientSnapshot, PrismaClient } from '@prisma/client';

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

export class PrismaSnapshotsRepository implements SnapshotsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertAppointment(data: UpsertAppointmentData): Promise<AppointmentSnapshot> {
    return this.prisma.appointmentSnapshot.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }

  async updateAppointmentStatus(id: string, status: string): Promise<AppointmentSnapshot | null> {
    try {
      return await this.prisma.appointmentSnapshot.update({ where: { id }, data: { status } });
    } catch {
      // P2025: no existe el snapshot todavía (AppointmentCreated no se
      // procesó aún, posible reordenamiento) — el caller decide qué hacer
      // (típicamente reintentar más tarde, no es un error permanente).
      return null;
    }
  }

  async getAppointment(id: string): Promise<AppointmentSnapshot | null> {
    return this.prisma.appointmentSnapshot.findUnique({ where: { id } });
  }

  async upsertPatient(data: UpsertPatientData): Promise<PatientSnapshot> {
    return this.prisma.patientSnapshot.upsert({ where: { id: data.id }, create: data, update: data });
  }

  async getPatient(id: string): Promise<PatientSnapshot | null> {
    return this.prisma.patientSnapshot.findUnique({ where: { id } });
  }

  async upsertDoctor(data: UpsertDoctorData): Promise<DoctorSnapshot> {
    return this.prisma.doctorSnapshot.upsert({ where: { id: data.id }, create: data, update: data });
  }

  async getDoctor(id: string): Promise<DoctorSnapshot | null> {
    return this.prisma.doctorSnapshot.findUnique({ where: { id } });
  }
}

export const buildSnapshotsRepository = (prisma: PrismaClient): SnapshotsRepository =>
  new PrismaSnapshotsRepository(prisma);
