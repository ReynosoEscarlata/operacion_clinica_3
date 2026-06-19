import type { Patient } from '@prisma/client';

import { Sentry } from '../../config/sentry.js';
import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import type {
  CreatePatientDto,
  ListPatientsQueryDto,
  UpdatePatientDto,
} from './patients.schemas.js';
import type { PatientRepository, PatientWithAppointments } from './patients.repository.js';

export interface StripeCustomersClient {
  customers: {
    create: (params: { email: string; name: string }) => Promise<{ id: string }>;
  };
}

export interface ListPatientsResult {
  items: Patient[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 20;

export class PatientService {
  constructor(
    private readonly repository: PatientRepository,
    private readonly stripeClient: StripeCustomersClient,
    private readonly logger: Logger,
  ) {}

  async create(dto: CreatePatientDto): Promise<Patient> {
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) {
      throw new AppError(409, 'PATIENT_EMAIL_TAKEN', 'Ya existe un paciente con ese email');
    }

    let stripeCustomerId: string;
    try {
      const customer = await this.stripeClient.customers.create({
        email: dto.email,
        name: dto.name,
      });
      stripeCustomerId = customer.id;
    } catch (error) {
      this.logger.error(
        { err: error, operation: 'createStripeCustomer', email: dto.email },
        'Error al crear Stripe Customer',
      );
      Sentry.captureException(error, { extra: { email: dto.email } });
      throw new AppError(502, 'STRIPE_UNAVAILABLE', 'Servicio de pago no disponible');
    }

    const patient = await this.repository.create({
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      stripeCustomerId,
    });

    this.logger.info(
      { patientId: patient.id, stripeCustomerId },
      'Paciente creado con Stripe Customer asociado',
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
  stripeClient: StripeCustomersClient;
  logger: Logger;
}

export const buildPatientService = (deps: PatientServiceDeps): PatientService =>
  new PatientService(deps.repository, deps.stripeClient, deps.logger);
