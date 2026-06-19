import type { Availability, Doctor } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import type { CreateDoctorDto, SetAvailabilityDto } from './doctors.schemas.js';
import type { DoctorRepository, DoctorWithAvailability } from './doctors.repository.js';
import { generateSlotsForDate, type Slot } from './slots.js';

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

export class DoctorService {
  constructor(
    private readonly repository: DoctorRepository,
    private readonly logger: Logger,
  ) {}

  async create(dto: CreateDoctorDto): Promise<Doctor> {
    const doctor = await this.repository.create(dto);
    this.logger.info({ doctorId: doctor.id }, 'Doctor creado');
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

  async setAvailability(doctorId: string, dto: SetAvailabilityDto): Promise<Availability[]> {
    const exists = await this.repository.exists(doctorId);
    if (!exists) {
      throw new AppError(404, 'DOCTOR_NOT_FOUND', 'Doctor no encontrado');
    }

    for (const block of dto.availability) {
      if (block.startTime >= block.endTime) {
        throw new AppError(
          400,
          'INVALID_AVAILABILITY_BLOCK',
          `El bloque ${block.startTime}-${block.endTime} es inválido: startTime debe ser menor que endTime`,
        );
      }
    }

    const availability = await this.repository.replaceAvailability(doctorId, dto.availability);
    this.logger.info(
      { doctorId, blocks: dto.availability.length },
      'Disponibilidad del doctor actualizada',
    );

    return availability;
  }

  async getSlots(doctorId: string, dateStr: string): Promise<Slot[]> {
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

    const rangeStart = new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day, 0, 0, 0, 0);
    const rangeEnd = new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day + 1, 0, 0, 0, 0);
    const appointments = await this.repository.findAppointmentsBetween(
      doctorId,
      rangeStart,
      rangeEnd,
    );

    const busyIntervals = appointments.map((appointment) => ({
      start: appointment.dateTime,
      end: new Date(appointment.dateTime.getTime() + appointment.durationMinutes * 60_000),
    }));

    return generateSlotsForDate(
      parsedDate.year,
      parsedDate.month,
      parsedDate.day,
      availability,
      busyIntervals,
    );
  }
}

export interface DoctorServiceDeps {
  repository: DoctorRepository;
  logger: Logger;
}

export const buildDoctorService = (deps: DoctorServiceDeps): DoctorService =>
  new DoctorService(deps.repository, deps.logger);
