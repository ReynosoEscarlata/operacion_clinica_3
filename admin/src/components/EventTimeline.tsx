import { formatRelativeTime } from '../lib/format';

export interface TimelineEntry {
  id: string;
  description: string;
  createdAt: string;
}

const asText = (value: unknown, fallback = '?'): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;

const describeEvent = (type: string, payload: Record<string, unknown>): string => {
  switch (type) {
    case 'CREATED':
      return 'Cita creada';
    case 'STATUS_CHANGED':
      return `Cambio de estado: ${asText(payload.from)} → ${asText(payload.to)}`;
    case 'PAYMENT_RECEIVED':
      return 'Pago recibido';
    case 'PAYMENT_FAILED':
      return 'Pago fallido';
    case 'EMAIL_SENT':
      return `Email enviado (${asText(payload.emailType, 'notificación')})`;
    case 'EMAIL_FAILED':
      return 'Falló el envío de un email';
    case 'WEBHOOK_RECEIVED':
      return 'Webhook de Stripe recibido';
    case 'REMINDER_SENT':
      return 'Recordatorio enviado';
    case 'CANCELLED': {
      const cancelledBy = payload.cancelledBy;
      const suffix = typeof cancelledBy === 'string' ? ` (${cancelledBy})` : '';
      return `Cita cancelada${suffix}`;
    }
    case 'RESCHEDULED':
      return 'Cita reprogramada';
    default:
      return type;
  }
};

export const buildTimelineEntries = (
  events: Array<{ id: string; type: string; payload: Record<string, unknown>; createdAt: string }>,
): TimelineEntry[] =>
  events
    .map((event) => ({
      id: event.id,
      description: describeEvent(event.type, event.payload),
      createdAt: event.createdAt,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

export const EventTimeline = ({ entries }: { entries: TimelineEntry[] }): JSX.Element => {
  if (entries.length === 0) {
    return <p className="text-sm text-black-600">No hay eventos registrados todavía.</p>;
  }

  return (
    <ol>
      {entries.map((entry, index) => (
        <li key={entry.id} className="flex gap-4">
          <div className="flex w-2 flex-shrink-0 flex-col items-center">
            <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
            {index < entries.length - 1 && <span className="w-0.5 flex-1 bg-blue-500" />}
          </div>
          <div className="pb-6">
            <p className="text-xs text-black-600">{formatRelativeTime(entry.createdAt)}</p>
            <p className="text-sm text-black-900">{entry.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
};
