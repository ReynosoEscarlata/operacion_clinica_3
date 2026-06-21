import type { Availability, Doctor, PrismaClient } from '@prisma/client';

import { writeOutboxEvent } from '../../lib/outbox.js';

export interface CreateDoctorData {
  name: string;
  email: string;
  specialty: string;
  consultationPriceCents: number;
}

export type DoctorBasic = Pick<Doctor, 'id' | 'consultationPriceCents'>;

export interface AvailabilityBlockData {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export type DoctorWithAvailability = Doctor & { availabilities: Availability[] };

export interface DoctorRepository {
  create: (data: CreateDoctorData) => Promise<Doctor>;
  findById: (id: string) => Promise<DoctorWithAvailability | null>;
  exists: (id: string) => Promise<boolean>;
  findBasicById: (id: string) => Promise<DoctorBasic | null>;
  findAll: () => Promise<Doctor[]>;
  addAvailability: (doctorId: string, block: AvailabilityBlockData) => Promise<Availability>;
  findAvailabilityForDay: (doctorId: string, dayOfWeek: number) => Promise<Availability[]>;
}

export class PrismaDoctorRepository implements DoctorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateDoctorData): Promise<Doctor> {
    return this.prisma.$transaction(async (tx) => {
      const doctor = await tx.doctor.create({ data });

      await writeOutboxEvent(tx, 'DoctorCreated', {
        doctorId: doctor.id,
        name: doctor.name,
        specialty: doctor.specialty,
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
    return this.prisma.$transaction(async (tx) => {
      const availability = await tx.availability.create({ data: { ...block, doctorId } });
      const doctor = await tx.doctor.findUniqueOrThrow({ where: { id: doctorId } });

      await writeOutboxEvent(tx, 'DoctorUpdated', {
        doctorId: doctor.id,
        name: doctor.name,
        specialty: doctor.specialty,
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
}

export const buildDoctorRepository = (prisma: PrismaClient): DoctorRepository =>
  new PrismaDoctorRepository(prisma);
