const currencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

export const formatCents = (cents: number): string => currencyFormatter.format(cents / 100);

// Formato absoluto: "15 jun 2026, 10:30" — usado para fechas de citas
// (muchas son futuras, así que "hace X" no aplica).
export const formatDateTime = (isoString: string): string => {
  const date = new Date(isoString);
  const datePart = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  const timePart = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
};

// Formato relativo: "hace 2 horas" — usado en el timeline de eventos
// (siempre referidos al pasado). Cae a formato absoluto si es muy antiguo.
export const formatRelativeTime = (isoString: string): string => {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes < 1) return 'hace un momento';
  if (diffMinutes < 60) return `hace ${diffMinutes} minuto${diffMinutes === 1 ? '' : 's'}`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} hora${diffHours === 1 ? '' : 's'}`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `hace ${diffDays} día${diffDays === 1 ? '' : 's'}`;

  return formatDateTime(isoString);
};

export const formatPercentage = (ratio: number): string => `${Math.round(ratio * 100)}%`;
