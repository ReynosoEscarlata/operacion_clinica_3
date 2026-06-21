import type { Patient } from '@prisma/client';

import type { PaymentsClient } from '../../clients/payments-client.js';
import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import type {
  CreatePatientDto,
  ListPatientsQueryDto,
  UpdatePatientDto,
} from './patients.schemas.js';
import type { PatientRepository, PatientWithAppointments } from './patients.repository.js';

export interface ListPatientsResult {
  items: Patient[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 20;

export class PatientService {
  constructor(
    private readonly repository: PatientRepository,
    private readonly paymentsClient: PaymentsClient,
    private readonly logger: Logger,
  ) {}

  async create(dto: CreatePatientDto): Promise<Patient> {
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) {
      throw new AppError(409, 'PATIENT_EMAIL_TAKEN', 'Ya existe un paciente con ese email');
    }

    const customer = await this.paymentsClient.createCustomer(dto.email, dto.name);

    const patient = await this.repository.create({
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      stripeCustomerId: customer.id,
    });

    this.logger.info(
      { patientId: patient.id, stripeCustomerId: customer.id },
      'Paciente creado con Stripe Customer asociado (vía Payments)',
    );

    return patient;
  }

  async getById(id: string): Promise<PatientWithAppointments> {
    const patient = await this.repository.findById(id);
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }
    return patient;
  }

  async getByEmail(email: string): Promise<Patient> {
    const patient = await this.repository.findByEmail(email);
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }
    return patient;
  }

  async update(id: string, dto: UpdatePatientDto): Promise<Patient> {
    const patient = await this.repository.update(id, dto);
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }
    return patient;
  }

  async list(query: ListPatientsQueryDto): Promise<ListPatientsResult> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const rows = await this.repository.list(
      query.cursor === undefined
        ? { limit: limit + 1 }
        : { cursor: query.cursor, limit: limit + 1 },
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return { items, nextCursor };
  }
}

export interface PatientServiceDeps {
  repository: PatientRepository;
  paymentsClient: PaymentsClient;
  logger: Logger;
}

export const buildPatientService = (deps: PatientServiceDeps): PatientService =>
  new PatientService(deps.repository, deps.paymentsClient, deps.logger);
