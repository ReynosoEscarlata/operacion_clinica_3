import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Layout } from '../components/Layout';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmModal } from '../components/ConfirmModal';
import { EventTimeline, buildTimelineEntries } from '../components/EventTimeline';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import {
  ApiError,
  cancelAppointment,
  completeAppointment,
  fetchAppointmentDetail,
  markAppointmentNoShow,
} from '../lib/api';
import { formatCents, formatDateTime } from '../lib/format';
import type { AppointmentDetail } from '../lib/types';

const FULL_REFUND_THRESHOLD_HOURS = 24;
const PARTIAL_REFUND_RATIO = 0.5;

const previewRefundCents = (appointment: AppointmentDetail): number => {
  const hoursUntil = (new Date(appointment.dateTime).getTime() - Date.now()) / 3_600_000;
  const isFullRefund = hoursUntil >= FULL_REFUND_THRESHOLD_HOURS;
  return isFullRefund ? appointment.amountCents : Math.round(appointment.amountCents * PARTIAL_REFUND_RATIO);
};

export const AppointmentDetailPage = (): JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const { adminKey } = useAdminAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);

  const loadDetail = (): void => {
    if (!adminKey || !id) return;
    setIsLoading(true);

    fetchAppointmentDetail(adminKey, id)
      .then((result) => setAppointment(result.appointment))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : 'No se pudo cargar la cita';
        showToast(message, 'error');
        if (error instanceof ApiError && error.status === 404) navigate('/admin/appointments');
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, id]);

  if (isLoading || !appointment) {
    return (
      <Layout title="Detalle de cita">
        <div className="h-48 animate-pulse rounded-card border border-black-300 bg-ice" />
      </Layout>
    );
  }

  const canCancel = appointment.status === 'PAID' || appointment.status === 'REMINDED';
  const canComplete = appointment.status === 'PAID' || appointment.status === 'REMINDED';
  const canMarkNoShow = appointment.status === 'REMINDED';

  const handleComplete = async (): Promise<void> => {
    if (!adminKey || !id) return;
    setIsSubmitting(true);
    try {
      await completeAppointment(adminKey, id);
      showToast('Cita marcada como completada', 'success');
      loadDetail();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo completar la cita';
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNoShow = async (): Promise<void> => {
    if (!adminKey || !id) return;
    setIsSubmitting(true);
    try {
      await markAppointmentNoShow(adminKey, id);
      showToast('Cita marcada como no-show', 'success');
      loadDetail();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo marcar como no-show';
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmCancel = async (): Promise<void> => {
    if (!adminKey || !id || cancelReason.trim().length === 0) return;
    setIsSubmitting(true);
    try {
      const result = await cancelAppointment(adminKey, id, cancelReason.trim());
      showToast(`Cita cancelada. Reembolso: ${formatCents(result.refundAmountCents)}`, 'success');
      setShowCancelModal(false);
      setCancelReason('');
      loadDetail();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo cancelar la cita';
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const timelineEntries = buildTimelineEntries(appointment.events);

  return (
    <Layout title="Detalle de cita">
      <div className="rounded-card border border-black-300 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-black-600">Paciente</p>
            <p className="text-lg font-semibold text-black-900">{appointment.patient.name}</p>
            <p className="text-sm text-black-600">{appointment.patient.email}</p>
          </div>
          <StatusBadge status={appointment.status} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-black-600">Doctor</p>
            <p className="text-sm text-black-900">{appointment.doctor.name}</p>
          </div>
          <div>
            <p className="text-xs text-black-600">Fecha y hora</p>
            <p className="text-sm text-black-900">{formatDateTime(appointment.dateTime)}</p>
          </div>
          <div>
            <p className="text-xs text-black-600">Monto</p>
            <p className="text-sm text-black-900">{formatCents(appointment.amountCents)}</p>
          </div>
        </div>

        {(canCancel || canComplete || canMarkNoShow) && (
          <div className="mt-6 flex flex-wrap gap-3 border-t border-black-300 pt-6">
            {canComplete && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleComplete()}
                className="rounded-btn bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Marcar completada
              </button>
            )}
            {canMarkNoShow && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleNoShow()}
                className="rounded-btn border border-black-300 px-4 py-2 text-sm font-medium text-black-900 hover:bg-ice disabled:opacity-50"
              >
                Marcar no-show
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowCancelModal(true)}
                className="rounded-btn border border-danger bg-white px-4 py-2 text-sm font-medium text-danger hover:bg-red-50 disabled:opacity-50"
              >
                Cancelar cita
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 rounded-card border border-black-300 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-black-900">Historial de eventos</h3>
        <EventTimeline entries={timelineEntries} />
      </div>

      {showCancelModal && (
        <ConfirmModal
          title="¿Cancelar esta cita?"
          danger
          isSubmitting={isSubmitting}
          confirmDisabled={cancelReason.trim().length === 0}
          confirmLabel="Cancelar cita"
          onCancel={() => {
            setShowCancelModal(false);
            setCancelReason('');
          }}
          onConfirm={() => void handleConfirmCancel()}
          description={
            <div className="flex flex-col gap-3">
              <p>
                Se emitirá un reembolso de <strong>{formatCents(previewRefundCents(appointment))}</strong> al
                paciente.
              </p>
              <label htmlFor="cancel-reason" className="text-xs font-medium text-black-600">
                Motivo de la cancelación
              </label>
              <textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                rows={3}
                className="rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900 focus:border-blue-500 focus:outline-none"
                placeholder="Ej: el doctor no está disponible"
              />
            </div>
          }
        />
      )}
    </Layout>
  );
};
