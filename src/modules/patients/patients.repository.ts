import type { Appointment, Patient, PrismaClient } from '@prisma/client';

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
    return this.prisma.patient.create({ data });
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
    try {
      return await this.prisma.patient.update({ where: { id }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async list(params: ListPatientsParams): Promise<Patient[]> {
    return this.prisma.patient.findMany({
      take: params.limit,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
      orderBy: { createdAt: 'asc' },
    });
  }
}

const isRecordNotFoundError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === 'P2025';

export const buildPatientRepository = (prisma: PrismaClient): PatientRepository =>
  new PrismaPatientRepository(prisma);
