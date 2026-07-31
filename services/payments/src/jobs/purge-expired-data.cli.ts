// Fase 5 (ADR-016): entrypoint manual del job de purga -- se ejecuta con
// `tsx src/jobs/purge-expired-data.cli.ts [--dry-run]`. No es un consumer
// de cola: la purga de retención corre por invocación explícita (cron
// externo/manual), nunca automáticamente al levantar el servicio.
import { prisma } from '../config/prisma.js';
import { logger } from '../lib/logger.js';
import { purgeExpiredData } from './purge-expired-data.job.js';

const dryRun = process.argv.includes('--dry-run');

purgeExpiredData({ prisma, logger }, { dryRun })
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error }, 'Error no controlado en el job de purga de retención');
    await prisma.$disconnect();
    process.exitCode = 1;
  });
