const CLINIC_NAME = 'Clínica Scheduler';

const layout = (headerColor: string, badgeBg: string, badgeColor: string, body: string): string => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; line-height: 1.5; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background-color: ${headerColor}; color: white; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 20px; }
      .content { background-color: #f7f9fc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
      .footer { color: #475569; font-size: 12px; text-align: center; }
      .status-badge { display: inline-block; background-color: ${badgeBg}; color: ${badgeColor}; padding: 4px 12px; border-radius: 16px; font-weight: 500; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header"><h1>${CLINIC_NAME}</h1></div>
      <div class="content">${body}</div>
      <div class="footer"><p>&copy; ${new Date().getFullYear()} ${CLINIC_NAME}. Todos los derechos reservados.</p></div>
    </div>
  </body>
</html>
`;

export const confirmationTemplate = (appointmentId: string, patientName: string, dateTime: string): string =>
  layout(
    '#2563eb',
    '#e8f0fe',
    '#2563eb',
    `
    <p>Hola ${patientName},</p>
    <p>Tu cita ha sido confirmada exitosamente.</p>
    <p>
      <strong>ID de cita:</strong> ${appointmentId.substring(0, 8)}<br>
      <strong>Fecha y hora:</strong> ${dateTime}<br>
      <strong>Estado:</strong> <span class="status-badge">PAGADA</span>
    </p>
    <p>Recibirás un recordatorio 24 horas antes de tu cita.</p>
    <p>Si necesitas cancelar o reprogramar, por favor contacta con nosotros.</p>
  `,
  );

export const reminderTemplate = (appointmentId: string, patientName: string, dateTime: string): string =>
  layout(
    '#d97706',
    '#fef3c7',
    '#d97706',
    `
    <p>Hola ${patientName},</p>
    <p><strong>Recordatorio:</strong> Tu cita está programada para mañana.</p>
    <p>
      <strong>ID de cita:</strong> ${appointmentId.substring(0, 8)}<br>
      <strong>Fecha y hora:</strong> ${dateTime}<br>
      <strong>Estado:</strong> <span class="status-badge">RECORDATORIO</span>
    </p>
    <p>Por favor, presenta en la clínica 10 minutos antes de tu cita.</p>
  `,
  );

export const cancellationTemplate = (
  appointmentId: string,
  patientName: string,
  refundAmount: string,
): string =>
  layout(
    '#dc2626',
    '#fee2e2',
    '#dc2626',
    `
    <p>Hola ${patientName},</p>
    <p>Tu cita ha sido cancelada.</p>
    <p>
      <strong>ID de cita:</strong> ${appointmentId.substring(0, 8)}<br>
      <strong>Reembolso:</strong> $${refundAmount}<br>
      <strong>Estado:</strong> <span class="status-badge">CANCELADA</span>
    </p>
    <p>El reembolso será procesado en 3-5 días hábiles.</p>
  `,
  );

export const paymentFailedTemplate = (appointmentId: string, patientName: string): string =>
  layout(
    '#dc2626',
    '#fee2e2',
    '#dc2626',
    `
    <p>Hola ${patientName},</p>
    <p>Nos comunicamos porque el pago de tu cita no pudo ser procesado.</p>
    <p>
      <strong>ID de cita:</strong> ${appointmentId.substring(0, 8)}<br>
      Por favor, intenta de nuevo o contacta con nuestro soporte.
    </p>
    <p>Tu cita será cancelada automáticamente en 30 minutos si no completas el pago.</p>
  `,
  );
