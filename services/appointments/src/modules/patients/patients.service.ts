import type { Patient } from '@prisma/client';

import type { DoctorsClient } from '../../clients/doctors-client.js';
import type { PaymentsClient } from '../../clients/payments-client.js';
import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import { getTenantId, runWithTenant } from '../../lib/tenant-context.js';
import { resolveTenantForPatient } from '../../lib/tenant-scoped.js';
import { prisma as defaultPrisma } from '../../config/prisma.js';
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
    private readonly doctorsClient: DoctorsClient,
    private readonly logger: Logger,
  ) {}

  // Ruta pública (paciente sin cuenta, RFC-001) -- el tenant se resuelve a
  // partir de doctorId (confirmado con Ricardo, Fase 3a: un paciente es un
  // registro por clínica, no una entidad global) y se entra explícitamente
  // en ese contexto antes de tocar el repositorio, igual que
  // AppointmentService.create.
  async create(dto: CreatePatientDto): Promise<Patient> {
    const doctor = await this.doctorsClient.getDoctor(dto.doctorId);
    if (!doctor) {
      throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor no encontrado');
    }

    return runWithTenant(doctor.tenantId, async () => {
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
    });
  }

  // Ruta pública por posesión de UUID (RFC-001), pero alcanzable también por
  // un admin autenticado (el gateway reenvía su tenant igual en rutas
  // "públicas" si hay JWT válido, ver gateway/proxy.ts). Distinción crítica
  // de seguridad: si YA hay un tenant ambiental (admin autenticado), se usa
  // ESE estrictamente -- nunca se cae al capability-token de otro tenant,
  // o un admin podría leer pacientes de una clínica ajena solo por conocer
  // el UUID. Solo cuando NO hay ningún tenant ambiental (paciente sin
  // cuenta, sin header) se resuelve el tenant desde la propia fila vía
  // resolve_tenant_for_patient (SECURITY DEFINER) -- ese es el riesgo
  // residual ya aceptado en el threat model (amenaza #3).
  async getById(id: string): Promise<PatientWithAppointments> {
    const ambientTenantId = getTenantId();

    if (ambientTenantId) {
      const patient = await this.repository.findById(id);
      if (!patient) {
        throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
      }
      return patient;
    }

    const tenantId = await resolveTenantForPatient(defaultPrisma, id);
    if (!tenantId) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }

    return runWithTenant(tenantId, async () => {
      const patient = await this.repository.findById(id);
      if (!patient) {
        throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
      }
      return patient;
    });
  }

  // Ruta pública (evita pacientes duplicados al reservar) -- mismo
  // mecanismo que create(): doctorId resuelve el tenant.
  async getByEmail(email: string, doctorId: string): Promise<Patient> {
    const doctor = await this.doctorsClient.getDoctor(doctorId);
    if (!doctor) {
      throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor no encontrado');
    }

    return runWithTenant(doctor.tenantId, async () => {
      const patient = await this.repository.findByEmail(email);
      if (!patient) {
        throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
      }
      return patient;
    });
  }

  // Protegida (admin/staff autenticado) -- el tenant ya viene del header
  // interno, vía el TenantContext ambiental normal.
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
  doctorsClient: DoctorsClient;
  logger: Logger;
}

export const buildPatientService = (deps: PatientServiceDeps): PatientService =>
  new PatientService(deps.repository, deps.paymentsClient, deps.doctorsClient, deps.logger);
