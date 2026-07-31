import { requirePermission } from '@clinica/authz';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { buildEmailChannel } from '../../clients/email-channel.js';
import { prisma as defaultPrisma } from '../../config/prisma.js';
import { buildEventHandlers } from '../../lib/event-handlers.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { buildDeadLetterController } from './dead-letter.controller.js';
import { buildDeadLetterRepository, type DeadLetterRepository } from './dead-letter.repository.js';
import { DeadLetterIdParams, type DeadLetterIdParamsDto } from './dead-letter.schemas.js';
import { buildDeadLetterService } from './dead-letter.service.js';
import { buildNotificationLogRepository } from './notification-log.repository.js';
import { buildNotificationService, type NotificationService } from './notification.service.js';
import { buildSnapshotsRepository } from './snapshots.repository.js';

export interface NotificationsRoutesDeps {
  prisma?: PrismaClient;
  deadLetterRepository?: DeadLetterRepository;
  notificationService?: NotificationService;
}

export const registerNotificationsRoutes = (
  app: FastifyInstance,
  deps: NotificationsRoutesDeps = {},
): void => {
  const prismaClient = deps.prisma ?? defaultPrisma;
  const deadLetterRepository = deps.deadLetterRepository ?? buildDeadLetterRepository(prismaClient);
  const notificationService =
    deps.notificationService ??
    buildNotificationService({
      snapshots: buildSnapshotsRepository(prismaClient),
      channel: buildEmailChannel(defaultLogger),
      logs: buildNotificationLogRepository(prismaClient),
      logger: defaultLogger,
    });

  const service = buildDeadLetterService(deadLetterRepository, buildEventHandlers(notificationService));
  const controller = buildDeadLetterController(service);

  // dead_letter:* (RFC-004) es exclusivo del plano de plataforma
  // (platform_admin/platform_support) -- ningún rol de tenant lo tiene.
  app.get(
    '/v1/dead-letter',
    { config: { authz: { permission: 'dead_letter:read' } }, preHandler: requirePermission('dead_letter:read') },
    controller.list,
  );
  app.post<{ Params: DeadLetterIdParamsDto }>(
    '/v1/dead-letter/:id/retry',
    {
      schema: { params: DeadLetterIdParams },
      config: { authz: { permission: 'dead_letter:retry' } },
      preHandler: requirePermission('dead_letter:retry'),
    },
    controller.retry,
  );
  app.delete<{ Params: DeadLetterIdParamsDto }>(
    '/v1/dead-letter/:id',
    {
      schema: { params: DeadLetterIdParams },
      config: { authz: { permission: 'dead_letter:remove' } },
      preHandler: requirePermission('dead_letter:remove'),
    },
    controller.remove,
  );
};
