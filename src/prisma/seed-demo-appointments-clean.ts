import 'dotenv/config';

import { readFile, rm } from 'node:fs/promises';

import { PrismaClient } from '@prisma/client';

import { DEMO_IDS_FILE } from './seed-demo-appointments.js';

const prisma = new PrismaClient();

const main = async (): Promise<void> => {
  let ids: string[] = [];

  try {
    ids = JSON.parse(await readFile(DEMO_IDS_FILE, 'utf8')) as string[];
  } catch {
    // eslint-disable-next-line no-console
    console.log('No hay un archivo de citas demo para limpiar (¿ya se borraron?).');
    return;
  }

  const { count } = await prisma.appointment.deleteMany({ where: { id: { in: ids } } });
  await rm(DEMO_IDS_FILE, { force: true });

  // eslint-disable-next-line no-console
  console.log(`Borradas ${count} citas demo (y sus eventos, por cascade).`);
};

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Error al limpiar el seed demo:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
