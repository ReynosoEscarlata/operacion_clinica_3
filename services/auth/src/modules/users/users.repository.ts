import type { PrismaClient, User } from '@prisma/client';

import { writeOutboxEvent } from '../../lib/outbox.js';

export interface CreateUserData {
  email: string;
  name: string;
  passwordHash: string;
  role: 'ADMIN' | 'STAFF';
}

export interface UsersRepository {
  create: (data: CreateUserData) => Promise<User>;
  findByEmail: (email: string) => Promise<User | null>;
  findById: (id: string) => Promise<User | null>;
  list: () => Promise<User[]>;
  deactivate: (id: string) => Promise<User | null>;
}

export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      await writeOutboxEvent(tx, 'UserCreated', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });
      return user;
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async list(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async deactivate(id: string): Promise<User | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) {
        return null;
      }
      if (!existing.active) {
        return existing;
      }

      const user = await tx.user.update({ where: { id }, data: { active: false } });
      await writeOutboxEvent(tx, 'UserDeactivated', { userId: user.id });
      return user;
    });
  }
}

export const buildUsersRepository = (prisma: PrismaClient): UsersRepository =>
  new PrismaUsersRepository(prisma);
