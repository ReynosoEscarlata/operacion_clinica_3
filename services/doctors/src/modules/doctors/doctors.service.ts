import type { Availability, Doctor } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { getAuthActor } from '../../lib/authz-context.js';
import type { Logger } from '../../lib/logger.js';
import { generateSlotsForDate, slotToIsoDateTime } from '../../lib/slots.js';
import { getTenantId } from '../../lib/tenant-context.js';
import type { CreateDoctorDto, SetAvailabilityDto } from './doctors.schemas.js';
import type { DoctorRepository, DoctorWithAvailability } from './doctors.repository.js';

const DATE_PARAM_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

const parseDateParam = (dateStr: string): ParsedDate => {
  const match = DATE_PARAM_REGEX.exec(dateStr);
  if (!match) {
    throw new AppError(400, 'INVALID_DATE', 'La fecha debe tener formato YYYY-MM-DD');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  const isRealCalendarDate =
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;

  if (!isRealCalendarDate) {
    throw new AppError(400, 'INVALID_DATE', 'La fecha no es un día de calendario válido');
  }

  return { year, month, day };
};

const assertNotInThePast = ({ year, month, day }: ParsedDate): void => {
  const requested = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (requested < today) {
    throw new AppError(400, 'PAST_DATE', 'La fecha debe ser hoy o una fecha futura');
  }
};

// Precio por defecto cuando no se especifica consultationPriceCents al crear
// el doctor — portado del monolito.
const DEFAULT_CONSULTATION_PRICE_CENTS = 50_000;

const DEFAULT_PRICE_CENTS_BY_SPECIALTY: Record<string, number> = {
  Cardiología: 80_000,
  Dermatología: 60_000,
  Pediatría: 50_000,
};

const resolveConsultationPrice = (specialty: string, explicitPriceCents?: number): number =>
  explicitPriceCents ?? DEFAULT_PRICE_CENTS_BY_SPECIALTY[specialty] ?? DEFAULT_CONSULTATION_PRICE_CENTS;

export class DoctorService {
  constructor(
    private readonly repository: DoctorRepository,
    private readonly logger: Logger,
  ) {}

  async create(dto: CreateDoctorDto): Promise<Doctor> {
    // El contrato público sigue recibiendo `specialty` como texto (sin
    // romper packages/contracts/doctors/openapi.yaml) pero ahora se resuelve
    // contra el catálogo MedicalSpecialty (RFC-003) -- ya no es texto libre
    // persistido tal cual, es una FK validada.
    const specialty = await this.repository.findSpecialtyByName(dto.specialty);
    if (!specialty) {
      throw new AppError(
        400,
        'INVALID_SPECIALTY',
        `La especialidad "${dto.specialty}" no existe en el catálogo`,
      );
    }

    const consultationPriceCents = resolveConsultationPrice(dto.specialty, dto.consultationPriceCents);
    const doctor = await this.repository.create({
      name: dto.name,
      email: dto.email,
      specialtyId: specialty.id,
      consultationPriceCents,
    });
    this.logger.info({ doctorId: doctor.id, consultationPriceCents }, 'Doctor creado');
    return doctor;
  }

  async getById(id: string): Promise<DoctorWithAvailability> {
    const doctor = await this.repository.findById(id);
    if (!doctor) {
      throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor no encontrado');
    }
    return doctor;
  }

  async listAll(): Promise<Doctor[]> {
    return this.repository.findAll();
  }

  async addAvailability(doctorId: string, dto: SetAvailabilityDto): Promise<Availability> {
    // No basta con `exists()` (lectura pública, sin tenant): un actor de un
    // tenant podría apuntar a un doctorId de OTRO tenant y, como
    // `addAvailability` etiqueta la nueva fila con SU PROPIO tenantId (ver
    // repository), terminaría inyectando disponibilidad ajena bajo su
    // tenant en el horario público de un doctor que no le pertenece. Se
    // verifica pertenencia explícitamente y se responde 404 (no 403) si no
    // coincide, igual que si el doctor no existiera -- no se revela más de
    // lo que el directorio público ya expone.
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new Error('addAvailability() llamado sin tenant en contexto');
    }
    const belongsToTenant = await this.repository.belongsToTenant(doctorId, tenantId);
    if (!belongsToTenant) {
      throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor no encontrado');
    }

    // RFC-004, filtro ABAC de propiedad: doctor:manage_availability es
    // 'own' para el rol doctor -- a diferencia del 404 de aislamiento de
    // tenant de arriba, acá sí es 403 (no 404): :id ya es público vía
    // doctor:read, no hay nada que ocultar sobre su existencia.
    const actor = getAuthActor();
    if (actor?.role === 'doctor' && actor.doctorId !== doctorId) {
      throw new AppError(403, 'FORBIDDEN', 'Solo puede gestionar su propia disponibilidad');
    }

    if (dto.startTime >= dto.endTime) {
      throw new AppError(
        400,
        'INVALID_AVAILABILITY_BLOCK',
        `El bloque ${dto.startTime}-${dto.endTime} es inválido: startTime debe ser menor que endTime`,
      );
    }

    const availability = await this.repository.addAvailability(doctorId, dto);
    this.logger.info({ doctorId, dayOfWeek: dto.dayOfWeek }, 'Disponibilidad del doctor actualizada');

    return availability;
  }

  // Devuelve los horarios disponibles como ISO datetimes (no como bloques
  // HH:MM con un flag "available" como hacía el monolito): es el contrato
  // que Appointments consume (packages/contracts/doctors/openapi.yaml).
  // "Disponible" = dentro del horario configurado — no filtra citas ya
  // reservadas, porque Doctors no tiene acceso a esa tabla (RFC-001).
  async getAvailableSlots(doctorId: string, dateStr: string): Promise<string[]> {
    const exists = await this.repository.exists(doctorId);
    if (!exists) {
      throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor no encontrado');
    }

    const parsedDate = parseDateParam(dateStr);
    assertNotInThePast(parsedDate);

    const dayOfWeek = new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day).getDay();
    const availability = await this.repository.findAvailabilityForDay(doctorId, dayOfWeek);

    if (availability.length === 0) {
      return [];
    }

    const slots = generateSlotsForDate(availability);

    return slots.map((slot) =>
      slotToIsoDateTime(parsedDate.year, parsedDate.month, parsedDate.day, slot.startTime),
    );
  }
}

export interface DoctorServiceDeps {
  repository: DoctorRepository;
  logger: Logger;
}

export const buildDoctorService = (deps: DoctorServiceDeps): DoctorService =>
  new DoctorService(deps.repository, deps.logger);
