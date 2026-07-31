import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/helpers/setup.ts'],
    // `infra/test/**` cuelga del vitest de la raíz (no de un vitest propio
    // de infra/package.json, ver open question #4 del plan de Fase 6,
    // ADR-017) -- infra/ resuelve `aws-cdk-lib` desde su PROPIO
    // node_modules (no workspace de npm), y la resolución de módulos ESM se
    // basa en la ubicación del archivo que hace el import, no en qué
    // vitest.config.ts disparó el test, así que esto funciona sin más.
    include: ['tests/**/*.test.ts', 'infra/test/**/*.test.ts'],
  },
});
