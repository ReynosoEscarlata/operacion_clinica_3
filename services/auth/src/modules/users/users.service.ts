import type { User } from '@prisma/client';

import { AppError } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import { hashPassword } from '../../lib/password.js';
import type { CreateUserDto } from './users.schemas.js';
import type { UsersRepository } from './users.repository.js';

export type PublicUser = Omit<User, 'passwordHash'>;

const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
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
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) {
      throw new AppError(409, 'USER_EMAIL_TAKEN', 'Ya existe un usuario con ese email');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.repository.create({
      email: dto.email,
      name: dto.name,
      role: dto.role,
      passwordHash,
    });

    this.logger.info({ userId: user.id, role: user.role }, 'Usuario Admin/Staff creado');

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
