import type { User } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import { getTenantId } from '../../lib/tenant-context.js';
import type { Logger } from '../../lib/logger.js';
import { hashPassword } from '../../lib/password.js';
import type { CreateUserDto } from './users.schemas.js';
import type { UsersRepository } from './users.repository.js';

export type PublicUser = Omit<User, 'passwordHash'>;

const PLATFORM_ROLES = new Set(['PLATFORM_ADMIN', 'PLATFORM_SUPPORT']);

const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  tenantId: user.tenantId,
  email: user.email,
  name: user.name,
  role: user.role,
  doctorId: user.doctorId,
  active: user.active,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly logger: Logger,
  ) {}

  async create(dto: CreateUserDto): Promise<PublicUser> {
    // Reglas de asignación de rol -- mismo principio que "tenantId nunca
    // viene del body" (RFC-003): un actor de tenant (tenantId no nulo, el
    // único caso posible hasta que Fase 4/commit 8 habilite login de
    // plataforma end-to-end vía la API) nunca puede crear un usuario de
    // plataforma, sin importar lo que declare requirePermission más
    // adelante -- esta es una segunda capa, no la única.
    if (getTenantId() !== null && PLATFORM_ROLES.has(dto.role)) {
      throw new AppError(
        403,
        'CANNOT_ASSIGN_PLATFORM_ROLE',
        'Un actor de tenant no puede crear usuarios con rol de plataforma',
      );
    }
    if (dto.role === 'DOCTOR' && !dto.doctorId) {
      throw new AppError(400, 'DOCTOR_ID_REQUIRED', 'role DOCTOR requiere doctorId');
    }
    if (dto.role !== 'DOCTOR' && dto.doctorId) {
      throw new AppError(400, 'DOCTOR_ID_NOT_ALLOWED', 'doctorId solo aplica a role DOCTOR');
    }

    const existing = await this.repository.findByEmail(dto.email);
    if (existing) {
      throw new AppError(409, 'USER_EMAIL_TAKEN', 'Ya existe un usuario con ese email');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.repository.create({
      email: dto.email,
      name: dto.name,
      role: dto.role,
      doctorId: dto.doctorId ?? null,
      passwordHash,
    });

    this.logger.info({ userId: user.id, role: user.role }, 'Usuario creado');

    return toPublicUser(user);
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.repository.list();
    return users.map(toPublicUser);
  }

  async deactivate(id: string): Promise<PublicUser> {
    const user = await this.repository.deactivate(id);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
    }
    return toPublicUser(user);
  }
}

export interface UsersServiceDeps {
  repository: UsersRepository;
  logger: Logger;
}

export const buildUsersService = (deps: UsersServiceDeps): UsersService =>
  new UsersService(deps.repository, deps.logger);
