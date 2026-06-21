import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { buildEmailChannel } from '../../clients/email-channel.js';
import { prisma as defaultPrisma } from '../../config/prisma.js';
import { buildEventHandlers } from '../../lib/event-handlers.js';
import { logger as defaultLogger } from '../../lib/logger.js';
import { buildDeadLetterController } from './dead-letter.controller.js';
import { buildDeadLetterRepository, type DeadLetterRepository } from './dead-letter.repository.js';
import { DeadLetterIdParams } from './dead-letter.schemas.js';
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

  app.get('/v1/dead-letter', controller.list);
  app.post('/v1/dead-letter/:id/retry', { schema: { params: DeadLetterIdParams } }, controller.retry);
  app.delete('/v1/dead-letter/:id', { schema: { params: DeadLetterIdParams } }, controller.remove);
};
