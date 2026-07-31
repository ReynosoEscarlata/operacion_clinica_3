import { useEffect, useState } from 'react';

import { ApiError, fetchPlatformActiveUsers, fetchPlatformDashboard, fetchPlatformMetrics } from '../lib/api';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import { Layout } from '../components/Layout';
import { StatsCard } from '../components/StatsCard';
import { formatCents } from '../lib/format';
import type { PlatformActiveUsers, PlatformDashboardStats, PlatformMetricsResult } from '../lib/types';

const SkeletonCard = (): JSX.Element => (
  <div className="h-24 animate-pulse rounded-card border border-black-300 bg-ice" />
);

const totalActiveUsers = (activeByRole: Record<string, number>): number =>
  Object.values(activeByRole).reduce((sum, count) => sum + count, 0);

// Clon estructural de DashboardPage.tsx (que es por-tenant, RLS) -- este es
// el equivalente agregado CROSS-TENANT (Fase 6, ADR-017). Fan-out a 3
// endpoints en 2 servicios (mismo patrón que fetchDeadLetterJobs):
// dashboard + metrics en Appointments, usuarios activos en Auth (RFC-001,
// cero estado compartido).
export const PlatformDashboardPage = (): JSX.Element => {
  const { accessToken } = useAdminAuth();
  const { showToast } = useToast();
  const [stats, setStats] = useState<PlatformDashboardStats | null>(null);
  const [metrics, setMetrics] = useState<PlatformMetricsResult | null>(null);
  const [activeUsers, setActiveUsers] = useState<PlatformActiveUsers | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;

    let isMounted = true;
    setIsLoading(true);

    Promise.all([
      fetchPlatformDashboard(accessToken),
      fetchPlatformMetrics(accessToken),
      fetchPlatformActiveUsers(accessToken),
    ])
      .then(([dashboardData, metricsData, activeUsersData]) => {
        if (!isMounted) return;
        setStats(dashboardData);
        setMetrics(metricsData);
        setActiveUsers(activeUsersData);
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : 'No se pudo cargar el dashboard ejecutivo';
        showToast(message, 'error');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  return (
    <Layout title="Dashboard ejecutivo">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading || !stats ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatsCard label="Citas hoy (todas las clínicas)" value={String(stats.appointmentsToday)} />
            <StatsCard label="Esta semana" value={String(stats.appointmentsThisWeek)} />
            <StatsCard label="Ingresos del mes" value={formatCents(stats.revenue.thisMonth)} />
            <StatsCard
              label="Usuarios activos"
              value={activeUsers ? String(totalActiveUsers(activeUsers.activeByRole)) : '—'}
            />
          </>
        )}
      </div>

      <div className="mt-8 rounded-card border border-black-300 bg-white p-6">
        <h3 className="text-lg font-semibold text-black-900">Salud técnica (últimos 15 min)</h3>
        {!metrics ? (
          <p className="mt-2 text-sm text-black-600">Cargando…</p>
        ) : !metrics.available ? (
          <p className="mt-2 text-sm text-warning">{metrics.reason}</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatsCard label="Requests" value={String(metrics.data.aggregate.requestCount)} />
              <StatsCard label="Error rate" value={`${metrics.data.aggregate.errorRatePercent.toFixed(2)}%`} />
              <StatsCard
                label="p95 (máx. entre servicios)"
                value={`${Math.round(metrics.data.aggregate.latencyP95MaxMs)}ms`}
              />
            </div>
            <p className="mt-3 text-xs text-black-600">
              El p95 agregado no es un promedio real (no se puede derivar matemáticamente de p95
              individuales) — es el máximo entre los p95 de cada servicio, una cota superior. El
              desglose exacto por tenant/ruta es una consulta de CloudWatch Logs Insights, no está
              en esta vista.
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {Object.entries(metrics.data.perService).map(([serviceName, serviceMetrics]) => (
                <li key={serviceName} className="flex items-center justify-between text-sm">
                  <span className="text-black-900">{serviceName}</span>
                  <span className="text-black-600">
                    {serviceMetrics.requestCount} req · {serviceMetrics.errorCount} errores ·{' '}
                    {Math.round(serviceMetrics.latencyP95Ms)}ms p95
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {stats && (
        <div className="mt-8 rounded-card border border-black-300 bg-white p-6">
          <h3 className="text-lg font-semibold text-black-900">Citas por estado (todas las clínicas)</h3>
          <ul className="mt-4 flex flex-col gap-2">
            {Object.entries(stats.byStatus).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-sm">
                <span className="text-black-900">{status}</span>
                <span className="text-black-600">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Layout>
  );
};
