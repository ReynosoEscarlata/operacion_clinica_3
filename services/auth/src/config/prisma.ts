import { PrismaClient } from '@prisma/client';

export const createPrismaClient = (): PrismaClient => new PrismaClient();

export const prisma = createPrismaClient();
