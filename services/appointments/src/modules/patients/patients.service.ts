import type { Patient } from '@prisma/client';

import type { DoctorsClient } from '../../clients/doctors-client.js';
import type { PaymentsClient } from '../../clients/payments-client.js';
import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import { auditCrossTenantMismatch } from '../../lib/security-audit.js';
import { getTenantId, runWithTenant } from '../../lib/tenant-context.js';
import { resolveTenantForPatient } from '../../lib/tenant-scoped.js';
import { prisma as defaultPrisma } from '../../config/prisma.js';
import type {
  CreatePatientDto,
  ListPatientsQueryDto,
  UpdatePatientDto,
} from './patients.schemas.js';
import type { AuditLogEntry, PatientRepository, PatientWithAppointments } from './patients.repository.js';

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

      // Fase 5 (ADR-013): stripeCustomerId es un identificador financiero
      // (PII, ver docs/baseline-challenge-4.md) -- no se loguea en texto
      // plano, ni siquiera junto a un id interno no sensible.
      this.logger.info({ patientId: patient.id }, 'Paciente creado con Stripe Customer asociado (vía Payments)');

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
        await auditCrossTenantMismatch(this.logger, 'patient', id, ambientTenantId, () =>
          resolveTenantForPatient(defaultPrisma, id),
        );
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

  // ARCO -- Acceso (plan maestro Fase 5). Mismo mecanismo de resolución de
  // tenant que getById (posesión de UUID o admin autenticado): el titular
  // de los datos no tiene cuenta (RFC-001), su UUID es la credencial.
  async getArcoExport(
    id: string,
  ): Promise<{ patient: PatientWithAppointments; auditHistory: AuditLogEntry[] }> {
    const ambientTenantId = getTenantId();

    const build = async (): Promise<{ patient: PatientWithAppointments; auditHistory: AuditLogEntry[] }> => {
      const patient = await this.repository.findById(id);
      if (!patient) {
        throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
      }
      const auditHistory = await this.repository.listAuditHistory(id);
      await this.repository.recordArcoAccess(id);
      return { patient, auditHistory };
    };

    if (ambientTenantId) {
      return this.runAmbientWithAudit(ambientTenantId, id, build);
    }

    const tenantId = await resolveTenantForPatient(defaultPrisma, id);
    if (!tenantId) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }
    return runWithTenant(tenantId, build);
  }

  // ARCO -- Cancelación: borrado bajo demanda, no espera al corte de
  // retención de ADR-016.
  async requestCancellation(id: string): Promise<void> {
    const ambientTenantId = getTenantId();

    const run = async (): Promise<void> => {
      const deleted = await this.repository.requestCancellation(id);
      if (!deleted) {
        throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
      }
    };

    if (ambientTenantId) {
      return this.runAmbientWithAudit(ambientTenantId, id, run);
    }

    const tenantId = await resolveTenantForPatient(defaultPrisma, id);
    if (!tenantId) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }
    return runWithTenant(tenantId, run);
  }

  // ARCO -- Oposición: bloquea comunicaciones no transaccionales
  // (recordatorios) -- las transaccionales (confirmación, cancelación,
  // pago fallido) siguen enviándose, son parte del servicio ya contratado.
  async setOptOut(id: string, optOut: boolean): Promise<Patient> {
    const ambientTenantId = getTenantId();

    const run = async (): Promise<Patient> => {
      const patient = await this.repository.setOptOut(id, optOut);
      if (!patient) {
        throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
      }
      return patient;
    };

    if (ambientTenantId) {
      return this.runAmbientWithAudit(ambientTenantId, id, run);
    }

    const tenantId = await resolveTenantForPatient(defaultPrisma, id);
    if (!tenantId) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', 'Paciente no encontrado');
    }
    return runWithTenant(tenantId, run);
  }

  // Envoltorio para las rutas ARCO (getArcoExport/requestCancellation/
  // setOptOut): todas comparten el mismo shape ambient-first, y todas
  // exponen a un admin autenticado exactamente el mismo riesgo de acceso
  // cross-tenant que getById -- capturar el 404 acá evita repetir el
  // try/catch en cada una.
  private async runAmbientWithAudit<T>(
    ambientTenantId: string,
    id: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AppError && error.code === 'PATIENT_NOT_FOUND') {
        await auditCrossTenantMismatch(this.logger, 'patient', id, ambientTenantId, () =>
          resolveTenantForPatient(defaultPrisma, id),
        );
      }
      throw error;
    }
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
