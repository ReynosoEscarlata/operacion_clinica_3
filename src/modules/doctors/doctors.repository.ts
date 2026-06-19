import type { Appointment, Availability, Doctor, PrismaClient } from '@prisma/client';

export interface CreateDoctorData {
  name: string;
  email: string;
  specialty: string;
}

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
  findAll: () => Promise<Doctor[]>;
  replaceAvailability: (doctorId: string, blocks: AvailabilityBlockData[]) => Promise<Availability[]>;
  findAvailabilityForDay: (doctorId: string, dayOfWeek: number) => Promise<Availability[]>;
  findAppointmentsBetween: (
    doctorId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ) => Promise<Appointment[]>;
}

export class PrismaDoctorRepository implements DoctorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateDoctorData): Promise<Doctor> {
    return this.prisma.doctor.create({ data });
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

  async findAll(): Promise<Doctor[]> {
    return this.prisma.doctor.findMany({ orderBy: { name: 'asc' } });
  }

  async replaceAvailability(
    doctorId: string,
    blocks: AvailabilityBlockData[],
  ): Promise<Availability[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.availability.deleteMany({ where: { doctorId } });
      await tx.availability.createMany({
        data: blocks.map((block) => ({ ...block, doctorId })),
      });
      return tx.availability.findMany({
        where: { doctorId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
  }

  async findAvailabilityForDay(doctorId: string, dayOfWeek: number): Promise<Availability[]> {
    return this.prisma.availability.findMany({
      where: { doctorId, dayOfWeek },
      orderBy: { startTime: 'asc' },
    });
  }

  async findAppointmentsBetween(
    doctorId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<Appointment[]> {
    return this.prisma.appointment.findMany({
      where: {
        doctorId,
        status: { not: 'CANCELLED' },
        dateTime: { gte: rangeStart, lt: rangeEnd },
      },
    });
  }
}

export const buildDoctorRepository = (prisma: PrismaClient): DoctorRepository =>
  new PrismaDoctorRepository(prisma);
