import type { Availability, Doctor, PrismaClient } from '@prisma/client';

import { writeOutboxEvent } from '../../lib/outbox.js';
import { getTenantId } from '../../lib/tenant-context.js';
import { withTenant } from '../../lib/tenant-scoped.js';

export interface CreateDoctorData {
  name: string;
  email: string;
  specialtyId: string;
  consultationPriceCents: number;
}

export type DoctorBasic = Pick<Doctor, 'id' | 'consultationPriceCents'>;

export interface AvailabilityBlockData {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export type DoctorWithAvailability = Doctor & { availabilities: Availability[] };

export interface MedicalSpecialtyLookup {
  id: string;
  name: string;
}

export interface DoctorRepository {
  create: (data: CreateDoctorData) => Promise<Doctor>;
  findById: (id: string) => Promise<DoctorWithAvailability | null>;
  exists: (id: string) => Promise<boolean>;
  /**
   * Lectura pública (igual que `exists`, sin `withTenant`) que además
   * compara el tenantId del doctor -- no expone más de lo que ya es público
   * (el directorio de doctores es de lectura libre), pero permite a las
   * mutaciones (ver addAvailability en doctors.service.ts) rechazar con 404
   * un intento de escribir sobre un doctor de OTRO tenant, sin depender
   * únicamente de RLS del lado de escritura.
   */
  belongsToTenant: (id: string, tenantId: string) => Promise<boolean>;
  findBasicById: (id: string) => Promise<DoctorBasic | null>;
  findAll: () => Promise<Doctor[]>;
  addAvailability: (doctorId: string, block: AvailabilityBlockData) => Promise<Availability>;
  findAvailabilityForDay: (doctorId: string, dayOfWeek: number) => Promise<Availability[]>;
  /** Catálogo cross-tenant (RFC-003) -- no requiere contexto de tenant. */
  findSpecialtyByName: (name: string) => Promise<MedicalSpecialtyLookup | null>;
}

// Lecturas (findById/exists/findBasicById/findAll/findAvailabilityForDay):
// SIN withTenant a propósito. El directorio de doctores es público por
// diseño (RLS con política `public_read USING (true)`, ver la migración
// SQL) -- un paciente sin cuenta necesita listarlos antes de que exista
// cualquier contexto de tenant. Solo las mutaciones (create/addAvailability)
// pasan por withTenant, porque la política de escritura sí exige el tenant
// del actor autenticado.
export class PrismaDoctorRepository implements DoctorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateDoctorData): Promise<Doctor> {
    return withTenant(this.prisma, async (tx) => {
      const tenantId = getTenantId();
      if (!tenantId) {
        throw new Error('create() llamado sin tenant en contexto');
      }

      const doctor = await tx.doctor.create({ data: { ...data, tenantId } });

      await writeOutboxEvent(tx, 'DoctorCreated', {
        doctorId: doctor.id,
        name: doctor.name,
        specialtyId: doctor.specialtyId,
      });

      return doctor;
    });
  }

  async findById(id: string): Promise<DoctorWithAvailability | null> {
    return this.prisma.doctor.findUnique({
      where: { id },
      include: { availabilities: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] } },
    });
  }

  async exists(id: string): Promise<boolean> {
    const doctor = await this.prisma.doctor.findUnique({ where: { id }, select: { id: true } });
    return doctor !== null;
  }

  async belongsToTenant(id: string, tenantId: string): Promise<boolean> {
    const doctor = await this.prisma.doctor.findUnique({ where: { id }, select: { tenantId: true } });
    return doctor?.tenantId === tenantId;
  }

  async findBasicById(id: string): Promise<DoctorBasic | null> {
    return this.prisma.doctor.findUnique({
      where: { id },
      select: { id: true, consultationPriceCents: true },
    });
  }

  async findAll(): Promise<Doctor[]> {
    return this.prisma.doctor.findMany({ orderBy: { name: 'asc' } });
  }

  async addAvailability(doctorId: string, block: AvailabilityBlockData): Promise<Availability> {
    return withTenant(this.prisma, async (tx) => {
      const tenantId = getTenantId();
      if (!tenantId) {
        throw new Error('addAvailability() llamado sin tenant en contexto');
      }

      const availability = await tx.availability.create({ data: { ...block, doctorId, tenantId } });
      const doctor = await tx.doctor.findUniqueOrThrow({ where: { id: doctorId } });

      await writeOutboxEvent(tx, 'DoctorUpdated', {
        doctorId: doctor.id,
        name: doctor.name,
        specialtyId: doctor.specialtyId,
      });

      return availability;
    });
  }

  async findAvailabilityForDay(doctorId: string, dayOfWeek: number): Promise<Availability[]> {
    return this.prisma.availability.findMany({
      where: { doctorId, dayOfWeek },
      orderBy: { startTime: 'asc' },
    });
  }

  async findSpecialtyByName(name: string): Promise<MedicalSpecialtyLookup | null> {
    return this.prisma.medicalSpecialty.findUnique({ where: { name } });
  }
}

export const buildDoctorRepository = (prisma: PrismaClient): DoctorRepository =>
  new PrismaDoctorRepository(prisma);
