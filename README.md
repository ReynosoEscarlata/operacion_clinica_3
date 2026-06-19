# Clínica Scheduler

Sistema de reserva de citas para una clínica médica con cobro online (Stripe), notificaciones por
email, colas asíncronas y panel administrativo.

Documentación de diseño en [SPEC.md](./SPEC.md) y plan de fases en
[docs/plan-clinica.md](./docs/plan-clinica.md).

## Stack

- Node.js + TypeScript (strict)
- Fastify
- Prisma + PostgreSQL
- BullMQ + Redis (ioredis)
- Stripe (modo test)
- Resend
- Pino + Sentry
- Vitest + Supertest
- ESLint + Prettier

## Requisitos

- Node.js >= 20
- Docker y Docker Compose

## Setup

1. Copiar variables de entorno:

   ```bash
   cp .env.example .env
   ```

2. Levantar PostgreSQL y Redis:

   ```bash
   docker compose up -d
   ```

3. Instalar dependencias:

   ```bash
   npm install
   ```

4. Generar el cliente de Prisma:

   ```bash
   npm run prisma:generate
   ```

5. Arrancar el servidor en modo desarrollo:

   ```bash
   make dev
   ```

6. Verificar el health check:

   ```bash
   curl http://localhost:3000/health
   ```

## Comandos

| Comando        | Descripción                              |
| -------------- | ----------------------------------------- |
| `make dev`     | Arranca el servidor en modo desarrollo    |
| `make test`    | Corre la suite de tests (Vitest)          |
| `make lint`    | Corre ESLint sobre todo el proyecto       |
| `make migrate` | Aplica migraciones de Prisma              |
| `make seed`    | Pobla la base de datos con datos de prueba|

## Estructura del proyecto

Ver [CLAUDE.md](./CLAUDE.md) para la convención completa de carpetas, estilo de código y
arquitectura por capas.

## Estado actual

Este repo está en **Fase 1 — Scaffold**: estructura de carpetas, configuración de infraestructura
y health check. Sin lógica de negocio todavía. Ver [docs/plan-clinica.md](./docs/plan-clinica.md)
para las fases siguientes.
