import { useEffect, useState } from 'react';

import { ApiError, fetchDashboard } from '../lib/api';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import { Layout } from '../components/Layout';
import { StatsCard } from '../components/StatsCard';
import { formatCents, formatPercentage } from '../lib/format';
import type { DashboardStats } from '../lib/types';

const SkeletonCard = (): JSX.Element => (
  <div className="h-24 animate-pulse rounded-card border border-black-300 bg-ice" />
);

export const DashboardPage = (): JSX.Element => {
  const { adminKey } = useAdminAuth();
  const { showToast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!adminKey) return;

    let isMounted = true;
    setIsLoading(true);

    fetchDashboard(adminKey)
      .then((data) => {
        if (isMounted) setStats(data);
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : 'No se pudo cargar el dashboard';
        showToast(message, 'error');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  const totalNoShow = stats?.noShowRateByDoctor.reduce((sum, doctor) => sum + doctor.noShowCount, 0) ?? 0;
  const totalCompleted = stats?.noShowRateByDoctor.reduce((sum, doctor) => sum + doctor.completedCount, 0) ?? 0;
  const overallNoShowRate = totalNoShow + totalCompleted === 0 ? 0 : totalNoShow / (totalNoShow + totalCompleted);

  return (
    <Layout title="Dashboard">
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
            <StatsCard label="Citas hoy" value={String(stats.appointmentsToday)} />
            <StatsCard label="Esta semana" value={String(stats.appointmentsThisWeek)} />
            <StatsCard label="Ingresos del mes" value={formatCents(stats.revenue.thisMonth)} />
            <StatsCard label="Tasa de no-show" value={formatPercentage(overallNoShowRate)} />
          </>
        )}
      </div>

      {stats && stats.noShowRateByDoctor.length > 0 && (
        <div className="mt-8 rounded-card border border-black-300 bg-white p-6">
          <h3 className="text-lg font-semibold text-black-900">Tasa de no-show por doctor</h3>
          <ul className="mt-4 flex flex-col gap-2">
            {stats.noShowRateByDoctor.map((doctor) => (
              <li key={doctor.doctorId} className="flex items-center justify-between text-sm">
                <span className="text-black-900">{doctor.doctorName}</span>
                <span className="text-black-600">
                  {formatPercentage(doctor.rate)} ({doctor.noShowCount}/{doctor.noShowCount + doctor.completedCount})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Layout>
  );
};
