import type { AppointmentStatus } from '../lib/types';

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  PAID: 'Pagada',
  REMINDED: 'Recordada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No-show',
};

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  PENDING: 'bg-blue-100 text-blue-500',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  PAID: 'bg-green-50 text-green-700',
  REMINDED: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-red-50 text-red-700',
  NO_SHOW: 'bg-slate-100 text-slate-500',
};

export const StatusBadge = ({ status }: { status: AppointmentStatus }): JSX.Element => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
  >
    {status === 'COMPLETED' && <span aria-hidden="true">✓</span>}
    {STATUS_LABELS[status]}
  </span>
);
