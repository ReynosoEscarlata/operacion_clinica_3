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
- Panel admin: React + Vite + Tailwind CSS (carpeta [admin/](./admin))

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

## Panel administrativo (frontend)

El panel admin vive en [admin/](./admin), como un proyecto Vite separado (su propio
`package.json`, sin compartir tooling con el backend).

```bash
cd admin
npm install
cp .env.example .env   # VITE_API_BASE_URL, por defecto http://localhost:3000
npm run dev            # http://localhost:5173
```

Requiere el backend corriendo (`make dev`) y la `ADMIN_API_KEY` configurada en el `.env` del
backend — esa misma key se ingresa al entrar al panel (se guarda solo en memoria, no en
localStorage).

## Estructura del proyecto

Ver [CLAUDE.md](./CLAUDE.md) para la convención completa de carpetas, estilo de código y
arquitectura por capas.

## Estado actual

Backend: módulos de patients, doctors, appointments (state machine + Stripe), webhooks de Stripe
con idempotencia, colas (BullMQ) de expiración/email/reminders/no-show, panel administrativo
(API) y dead-letter. Frontend: panel admin (Dashboard, Citas, Detalle de cita, Dead Letter).
Ver [docs/plan-clinica.md](./docs/plan-clinica.md) para el detalle de cada fase.
