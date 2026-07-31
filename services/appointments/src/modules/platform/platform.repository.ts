import type { PrismaClient } from '@prisma/client';

import {
  platformAppointmentAggregates,
  platformRevenueAggregates,
  platformStatusCounts,
} from '../../lib/platform-scoped.js';

export interface PlatformDashboardStats {
  appointmentsToday: number;
  appointmentsThisWeek: number;
  byStatus: Record<string, number>;
  revenue: { today: number; thisWeek: number; thisMonth: number };
}

export interface PlatformRepository {
  getDashboardStats: () => Promise<PlatformDashboardStats>;
}

// Calcado de AppointmentRepository.getDashboardStats (appointments.repository.ts)
// pero cross-tenant vía las funciones SECURITY DEFINER de platform-scoped.ts
// en vez de withTenant() -- nunca puede reusar ese método directo porque
// withTenant() exige un tenant ambiental (RLS), y este dashboard
// deliberadamente no tiene uno (RFC-004, plano de plataforma).
export const buildPlatformRepository = (prisma: PrismaClient): PlatformRepository => ({
  getDashboardStats: async () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday.getTime() - startOfToday.getDay() * 86_400_000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [statusRows, appointmentAggregates, revenueAggregates] = await Promise.all([
      platformStatusCounts(prisma),
      platformAppointmentAggregates(prisma, startOfToday, startOfWeek),
      platformRevenueAggregates(prisma, startOfToday, startOfWeek, startOfMonth),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusRows) {
      byStatus[row.status] = Number(row.count);
    }

    return {
      appointmentsToday: Number(appointmentAggregates?.appointments_today ?? 0),
      appointmentsThisWeek: Number(appointmentAggregates?.appointments_this_week ?? 0),
      byStatus,
      revenue: {
        today: Number(revenueAggregates?.revenue_today ?? 0),
        thisWeek: Number(revenueAggregates?.revenue_this_week ?? 0),
        thisMonth: Number(revenueAggregates?.revenue_this_month ?? 0),
      },
    };
  },
});
