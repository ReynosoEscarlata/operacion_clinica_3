import type { ReactNode } from 'react';

interface ConfirmModalProps {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  isSubmitting?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal = ({
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  isSubmitting = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps): JSX.Element => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black-900/50 p-4">
    <div className="w-full max-w-sm rounded-modal bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-black-900">{title}</h2>
      <div className="mt-2 text-sm text-black-600">{description}</div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-btn border border-black-300 px-4 py-2 text-sm font-medium text-black-900 hover:bg-ice disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting || confirmDisabled}
          className={`rounded-btn px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            danger
              ? 'border border-danger bg-white text-danger hover:bg-red-50'
              : 'bg-blue-500 text-white hover:bg-blue-700'
          }`}
        >
          {isSubmitting ? 'Procesando…' : confirmLabel}
        </button>
      </div>
    </div>
  </div>
);
