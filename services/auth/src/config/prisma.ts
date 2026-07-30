import { PrismaClient } from '@prisma/client';

import { env } from './env.js';

// Conecta como `app_role` (sin BYPASSRLS, ADR-006) -- nunca con la misma
// credencial que usa `prisma migrate deploy` (esa es owner de la base y
// bypasea RLS). Ver docs/runbooks/migracion-tenant-id.md.
export const createPrismaClient = (): PrismaClient =>
  new PrismaClient({ datasourceUrl: env.DATABASE_URL_APP });

export const prisma = createPrismaClient();
