import { useToast, type ToastType } from '../context/ToastContext';

const BORDER_BY_TYPE: Record<ToastType, string> = {
  success: 'border-success',
  error: 'border-danger',
  info: 'border-blue-500',
};

export const ToastContainer = (): JSX.Element => {
  const { toasts, dismissToast } = useToast();

  return (
    <div className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className={`flex items-start justify-between gap-3 rounded-card border-l-4 bg-white p-4 text-sm shadow-sm ${BORDER_BY_TYPE[toast.type]}`}
        >
          <span className="text-black-900">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Cerrar notificación"
            className="text-black-600 hover:text-black-900"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
