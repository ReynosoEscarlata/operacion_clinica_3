import type { PrismaClient, SupportAccessGrant } from '@prisma/client';

export interface CreateSupportAccessGrantData {
  actorId: string;
  actorRole: string; // formato @clinica/authz (snake_case), ver users.mapper.ts
  tenantId: string;
  reason: string;
  expiresAt: Date;
}

export interface SupportAccessGrantRepository {
  create: (data: CreateSupportAccessGrantData) => Promise<SupportAccessGrant>;
}

export class PrismaSupportAccessGrantRepository implements SupportAccessGrantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateSupportAccessGrantData): Promise<SupportAccessGrant> {
    return this.prisma.$transaction(async (tx) => {
      // SupportAccessGrant: la política RLS exige app.actor_role de
      // plataforma, no compara tenantId (ver migración SQL) -- nunca hace
      // falta setear app.current_tenant para este insert.
      await tx.$executeRaw`SELECT set_config('app.actor_role', ${data.actorRole}, true)`;
      const grant = await tx.supportAccessGrant.create({
        data: {
          actorId: data.actorId,
          tenantId: data.tenantId,
          reason: data.reason,
          expiresAt: data.expiresAt,
        },
      });

      // OutboxEvent SÍ pertenece al tenant OBJETIVO del grant (para que
      // Notifications lo consuma en el contexto correcto, RFC-004 punto 4
      // "notificación al tenant") -- distinto del actor de plataforma que lo
      // origina, así que se fija app.current_tenant a ese tenant
      // específicamente para este segundo insert dentro de la misma
      // transacción.
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${data.tenantId}, true)`;
      await tx.outboxEvent.create({
        data: {
          tenantId: data.tenantId,
          type: 'SupportAccessGranted',
          payload: {
            grantId: grant.id,
            actorId: data.actorId,
            reason: data.reason,
            expiresAt: data.expiresAt.toISOString(),
          },
        },
      });

      return grant;
    });
  }
}

export const buildSupportAccessGrantRepository = (prisma: PrismaClient): SupportAccessGrantRepository =>
  new PrismaSupportAccessGrantRepository(prisma);
