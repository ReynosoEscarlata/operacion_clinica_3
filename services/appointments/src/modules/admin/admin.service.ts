import type { DeadLetterEntry } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import type { DeadLetterRepository } from '../../lib/dead-letter.repository.js';
import type { AppointmentRepository, DashboardStats } from '../appointments/appointments.repository.js';
import type { AdminRepository } from './admin.repository.js';

export interface RecentEventItem {
  id: string;
  appointmentId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export class AdminService {
  constructor(
    private readonly appointmentRepository: AppointmentRepository,
    private readonly deadLetterRepository: DeadLetterRepository,
    private readonly adminRepository: AdminRepository,
  ) {}

  getDashboard(): Promise<DashboardStats> {
    return this.appointmentRepository.getDashboardStats();
  }

  async getRecentEvents(hours: number): Promise<RecentEventItem[]> {
    const events = await this.appointmentRepository.listRecentEvents(hours);
    return events.map((event) => ({
      id: event.id,
      appointmentId: event.appointmentId,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    }));
  }

  listDeadLetter(): Promise<DeadLetterEntry[]> {
    return this.deadLetterRepository.list();
  }

  retryDeadLetter(id: string): Promise<void> {
    return this.adminRepository.retryDeadLetterEntry(id);
  }

  async removeDeadLetter(id: string): Promise<void> {
    const entry = await this.deadLetterRepository.findById(id);
    if (!entry) {
      throw new AppError(404, 'DEAD_LETTER_NOT_FOUND', 'Entrada de dead-letter no encontrada');
    }
    await this.deadLetterRepository.remove(id);
  }
}

export interface AdminServiceDeps {
  appointmentRepository: AppointmentRepository;
  deadLetterRepository: DeadLetterRepository;
  adminRepository: AdminRepository;
}

export const buildAdminService = (deps: AdminServiceDeps): AdminService =>
  new AdminService(deps.appointmentRepository, deps.deadLetterRepository, deps.adminRepository);
