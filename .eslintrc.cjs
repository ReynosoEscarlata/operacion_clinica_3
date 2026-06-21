module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'error',
  },
  // services/, gateway/ y packages/ tienen su propio .eslintrc.cjs, tsconfig
  // y pipeline de CI independiente (ver Challenge 4 / PLAN.md Fase 1) — el
  // lint del monolito no debe entrar ahí, igual que su CI ya está acotado
  // por `paths:` a su propio código.
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    'vitest.config.ts',
    '.eslintrc.cjs',
    'admin',
    'services',
    'gateway',
    'packages',
    'scripts',
    'pacts',
  ],
};
