import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Layout } from '../components/Layout';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError, fetchAppointments, fetchDoctors } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { AppointmentListItem, AppointmentStatus, Doctor } from '../lib/types';

const STATUS_OPTIONS: AppointmentStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PAID',
  'REMINDED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

interface Filters {
  status: string;
  doctorId: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = { status: '', doctorId: '', dateFrom: '', dateTo: '' };

const buildQueryString = (filters: Filters, cursor: string | null): string => {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.doctorId) params.set('doctorId', filters.doctorId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const AppointmentsListPage = (): JSX.Element => {
  const { adminKey } = useAdminAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [items, setItems] = useState<AppointmentListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [isLoading, setIsLoading] = useState(true);

  const currentCursor = cursorStack[cursorStack.length - 1] ?? null;

  useEffect(() => {
    fetchDoctors()
      .then(setDoctors)
      .catch(() => showToast('No se pudo cargar la lista de doctores', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!adminKey) return;

    let isMounted = true;
    setIsLoading(true);

    fetchAppointments(adminKey, buildQueryString(filters, currentCursor))
      .then((result) => {
        if (!isMounted) return;
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : 'No se pudieron cargar las citas';
        showToast(message, 'error');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, filters, currentCursor]);

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }));
    setCursorStack([null]);
  };

  const goToNextPage = (): void => {
    if (nextCursor) setCursorStack((stack) => [...stack, nextCursor]);
  };

  const goToPreviousPage = (): void => {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  };

  const columns: Array<DataTableColumn<AppointmentListItem>> = [
    { header: 'Paciente', render: (row) => row.patient.name },
    { header: 'Doctor', render: (row) => row.doctor.name },
    { header: 'Fecha/hora', render: (row) => formatDateTime(row.dateTime) },
    { header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      header: 'Acciones',
      render: (row) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/appointments/${row.id}`);
          }}
          className="text-sm font-medium text-blue-500 hover:text-blue-700"
        >
          Ver detalle
        </button>
      ),
    },
  ];

  return (
    <Layout title="Citas">
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-card border border-black-300 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-black-600">Status</label>
          <select
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            className="mt-1 rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-black-600">Doctor</label>
          <select
            value={filters.doctorId}
            onChange={(event) => updateFilter('doctorId', event.target.value)}
            className="mt-1 rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900"
          >
            <option value="">Todos</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-black-600">Desde</label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
            className="mt-1 rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-black-600">Hasta</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
            className="mt-1 rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900"
          />
        </div>

        {(filters.status || filters.doctorId || filters.dateFrom || filters.dateTo) && (
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setCursorStack([null]);
            }}
            className="rounded-btn border border-black-300 px-4 py-2 text-sm font-medium text-black-900 hover:bg-ice"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-card border border-black-300 bg-ice" />
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/appointments/${row.id}`)}
          emptyMessage="No hay citas para estos filtros"
        />
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={goToPreviousPage}
          disabled={cursorStack.length <= 1}
          className="rounded-btn border border-black-300 px-4 py-2 text-sm font-medium text-black-900 hover:bg-ice disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={goToNextPage}
          disabled={!nextCursor}
          className="rounded-btn border border-black-300 px-4 py-2 text-sm font-medium text-black-900 hover:bg-ice disabled:opacity-50"
        >
          Siguiente
        </button>
      </div>
    </Layout>
  );
};
