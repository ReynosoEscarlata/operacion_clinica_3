import type { PrismaClient, User } from '@prisma/client';

import { writeOutboxEvent } from '../../lib/outbox.js';
import { getTenantId } from '../../lib/tenant-context.js';
import { withTenant } from '../../lib/tenant-scoped.js';

export interface CreateUserData {
  email: string;
  name: string;
  passwordHash: string;
  role: 'ADMIN' | 'STAFF';
}

// Fila mínima para decidir autenticación -- nunca la fila completa de User
// (ver find_user_for_login/find_user_by_id_for_refresh en la migración: son
// la única excepción deliberada a RLS en este servicio, acotada a estas
// columnas).
export interface UserAuthLookup {
  id: string;
  tenantId: string | null;
  passwordHash: string;
  active: boolean;
  role: 'ADMIN' | 'STAFF';
}

export interface UserRefreshLookup {
  id: string;
  tenantId: string | null;
  active: boolean;
  role: 'ADMIN' | 'STAFF';
}

export interface UsersRepository {
  create: (data: CreateUserData) => Promise<User>;
  findByEmail: (email: string) => Promise<User | null>;
  findById: (id: string) => Promise<User | null>;
  list: () => Promise<User[]>;
  deactivate: (id: string) => Promise<User | null>;
  /** Búsqueda cross-tenant intencional -- solo para el flujo de login. */
  findByEmailForLogin: (email: string) => Promise<UserAuthLookup | null>;
  /** Búsqueda cross-tenant intencional -- solo para el flujo de refresh. */
  findByIdForRefresh: (id: string) => Promise<UserRefreshLookup | null>;
}

export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateUserData): Promise<User> {
    // El nuevo usuario hereda el tenant del actor que lo crea -- nunca se
    // acepta un tenantId desde el body (ver users.schemas.ts, sin ese campo).
    const tenantId = getTenantId() ?? null;

    return withTenant(this.prisma, async (tx) => {
      const user = await tx.user.create({ data: { ...data, tenantId } });
      await writeOutboxEvent(tx, 'UserCreated', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });
      return user;
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return withTenant(this.prisma, (tx) => tx.user.findUnique({ where: { email } }));
  }

  async findById(id: string): Promise<User | null> {
    return withTenant(this.prisma, (tx) => tx.user.findUnique({ where: { id } }));
  }

  async list(): Promise<User[]> {
    return withTenant(this.prisma, (tx) => tx.user.findMany({ orderBy: { createdAt: 'asc' } }));
  }

  async deactivate(id: string): Promise<User | null> {
    return withTenant(this.prisma, async (tx) => {
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

  async findByEmailForLogin(email: string): Promise<UserAuthLookup | null> {
    const rows = await this.prisma.$queryRaw<UserAuthLookup[]>`
      SELECT * FROM find_user_for_login(${email})
    `;
    return rows[0] ?? null;
  }

  async findByIdForRefresh(id: string): Promise<UserRefreshLookup | null> {
    const rows = await this.prisma.$queryRaw<UserRefreshLookup[]>`
      SELECT * FROM find_user_by_id_for_refresh(${id}::uuid)
    `;
    return rows[0] ?? null;
  }
}

export const buildUsersRepository = (prisma: PrismaClient): UsersRepository =>
  new PrismaUsersRepository(prisma);
