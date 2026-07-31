import type { PrismaClient } from '@prisma/client';

// Fase 6 (ADR-017): equivalente a tenant-scoped.ts pero para el plano de
// plataforma -- estas 3 funciones SECURITY DEFINER (migración
// 20260731150000_add_platform_aggregates) agregan a propósito CROSS-TENANT,
// nunca dentro de withTenant()/runWithTenant(). Regla no negociable: solo
// agregados + conteos, jamás una fila con PII (nombre, email, motivo de
// cancelación) -- ver GRANT EXECUTE en la migración.
export interface StatusCountRow {
  status: string;
  count: bigint;
}

export interface AppointmentAggregatesRow {
  appointments_today: bigint;
  appointments_this_week: bigint;
}

export interface RevenueAggregatesRow {
  revenue_today: bigint;
  revenue_this_week: bigint;
  revenue_this_month: bigint;
}

export const platformStatusCounts = (prisma: PrismaClient): Promise<StatusCountRow[]> =>
  prisma.$queryRaw<StatusCountRow[]>`SELECT * FROM platform_status_counts()`;

export const platformAppointmentAggregates = (
  prisma: PrismaClient,
  startToday: Date,
  startWeek: Date,
): Promise<AppointmentAggregatesRow | undefined> =>
  prisma
    .$queryRaw<AppointmentAggregatesRow[]>`SELECT * FROM platform_appointment_aggregates(${startToday}, ${startWeek})`
    .then((rows) => rows[0]);

export const platformRevenueAggregates = (
  prisma: PrismaClient,
  startToday: Date,
  startWeek: Date,
  startMonth: Date,
): Promise<RevenueAggregatesRow | undefined> =>
  prisma
    .$queryRaw<RevenueAggregatesRow[]>`SELECT * FROM platform_revenue_aggregates(${startToday}, ${startWeek}, ${startMonth})`
    .then((rows) => rows[0]);
