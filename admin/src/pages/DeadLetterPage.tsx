import { Fragment, useEffect, useState } from 'react';

import { Layout } from '../components/Layout';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError, fetchDeadLetterJobs } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { DeadLetterJob } from '../lib/types';

export const DeadLetterPage = (): JSX.Element => {
  const { adminKey } = useAdminAuth();
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<DeadLetterJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!adminKey) return;
    let isMounted = true;

    fetchDeadLetterJobs(adminKey)
      .then((result) => {
        if (isMounted) setJobs(result.data);
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : 'No se pudieron cargar los jobs fallidos';
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
        <p className="text-sm text-black-600">No hay jobs fallidos en este momento.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-black-300 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-ice">
              <tr>
                <th className="px-4 py-3 font-medium text-black-600">Job ID</th>
                <th className="px-4 py-3 font-medium text-black-600">Cola</th>
                <th className="px-4 py-3 font-medium text-black-600">Error</th>
                <th className="px-4 py-3 font-medium text-black-600">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const key = `${job.queueName}-${job.id}`;
                const isExpanded = expandedJobId === key;
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={() => setExpandedJobId(isExpanded ? null : key)}
                      className="cursor-pointer border-t border-black-300 bg-red-50 hover:bg-red-100"
                    >
                      <td className="px-4 py-3 text-black-900">{job.id}</td>
                      <td className="px-4 py-3 text-black-900">{job.queueName}</td>
                      <td className="px-4 py-3 text-black-900">{job.failedReason}</td>
                      <td className="px-4 py-3 text-black-900">
                        {formatDateTime(new Date(Number(job.timestamp)).toISOString())}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-black-300 bg-ice">
                        <td colSpan={4} className="px-4 py-3">
                          <pre className="overflow-x-auto text-xs text-black-900">
                            {JSON.stringify(job.data, null, 2)}
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
