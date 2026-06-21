import { Fragment, useEffect, useState } from 'react';

import { Layout } from '../components/Layout';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError, fetchDeadLetterJobs, removeDeadLetterJob, retryDeadLetterJob } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { DeadLetterJob } from '../lib/types';

const SOURCE_LABEL: Record<DeadLetterJob['source'], string> = {
  appointments: 'Appointments',
  notifications: 'Notifications',
};

export const DeadLetterPage = (): JSX.Element => {
  const { accessToken } = useAdminAuth();
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<DeadLetterJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const loadJobs = (): void => {
    if (!accessToken) return;
    setIsLoading(true);

    fetchDeadLetterJobs(accessToken)
      .then((result) => setJobs(result.data))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : 'No se pudieron cargar los jobs fallidos';
        showToast(message, 'error');
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const handleRetry = async (job: DeadLetterJob): Promise<void> => {
    if (!accessToken) return;
    setActioningId(job.id);
    try {
      await retryDeadLetterJob(accessToken, job.source, job.id);
      showToast('Reintentado correctamente', 'success');
      loadJobs();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo reintentar';
      showToast(message, 'error');
    } finally {
      setActioningId(null);
    }
  };

  const handleRemove = async (job: DeadLetterJob): Promise<void> => {
    if (!accessToken) return;
    setActioningId(job.id);
    try {
      await removeDeadLetterJob(accessToken, job.source, job.id);
      showToast('Entrada eliminada', 'success');
      loadJobs();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo eliminar';
      showToast(message, 'error');
    } finally {
      setActioningId(null);
    }
  };

  if (isLoading) {
    return (
      <Layout title="Dead Letter">
        <div className="h-64 animate-pulse rounded-card border border-black-300 bg-ice" />
      </Layout>
    );
  }

  return (
    <Layout title="Dead Letter">
      {jobs.length === 0 ? (
        <p className="text-sm text-black-600">No hay eventos en dead-letter en este momento.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-black-300 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-ice">
              <tr>
                <th className="px-4 py-3 font-medium text-black-600">Servicio</th>
                <th className="px-4 py-3 font-medium text-black-600">Tipo de evento</th>
                <th className="px-4 py-3 font-medium text-black-600">Error</th>
                <th className="px-4 py-3 font-medium text-black-600">Fecha</th>
                <th className="px-4 py-3 font-medium text-black-600">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const key = `${job.source}-${job.id}`;
                const isExpanded = expandedJobId === key;
                return (
                  <Fragment key={key}>
                    <tr className="border-t border-black-300 bg-red-50 hover:bg-red-100">
                      <td
                        className="cursor-pointer px-4 py-3 text-black-900"
                        onClick={() => setExpandedJobId(isExpanded ? null : key)}
                      >
                        {SOURCE_LABEL[job.source]}
                      </td>
                      <td
                        className="cursor-pointer px-4 py-3 text-black-900"
                        onClick={() => setExpandedJobId(isExpanded ? null : key)}
                      >
                        {job.eventType}
                      </td>
                      <td
                        className="cursor-pointer px-4 py-3 text-black-900"
                        onClick={() => setExpandedJobId(isExpanded ? null : key)}
                      >
                        {job.error}
                      </td>
                      <td
                        className="cursor-pointer px-4 py-3 text-black-900"
                        onClick={() => setExpandedJobId(isExpanded ? null : key)}
                      >
                        {formatDateTime(job.failedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={actioningId === job.id}
                            onClick={() => void handleRetry(job)}
                            className="rounded-btn bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Reintentar
                          </button>
                          <button
                            type="button"
                            disabled={actioningId === job.id}
                            onClick={() => void handleRemove(job)}
                            className="rounded-btn border border-danger px-3 py-1 text-xs font-medium text-danger hover:bg-red-50 disabled:opacity-50"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-black-300 bg-ice">
                        <td colSpan={5} className="px-4 py-3">
                          <pre className="overflow-x-auto text-xs text-black-900">
                            {JSON.stringify(job.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
};
