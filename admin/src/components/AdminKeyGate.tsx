import { useState, type FormEvent, type ReactNode } from 'react';

import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';

export const AdminKeyGate = ({ children }: { children: ReactNode }): JSX.Element => {
  const { adminKey, isAuthenticating, login } = useAdminAuth();
  const { showToast } = useToast();
  const [keyInput, setKeyInput] = useState('');

  if (adminKey) {
    return <>{children}</>;
  }

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) return;

    const success = await login(trimmedKey);
    if (!success) {
      showToast('La API key ingresada es incorrecta', 'error');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ice p-4">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-sm rounded-modal bg-white p-8 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-black-900">Clínica — Panel administrativo</h1>
        <p className="mt-1 text-sm text-black-600">Ingresá la API key de administrador para continuar.</p>

        <label htmlFor="admin-key" className="mt-6 block text-sm font-medium text-black-900">
          API key
        </label>
        <input
          id="admin-key"
          type="password"
          autoFocus
          value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          className="mt-2 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900 focus:border-blue-500 focus:outline-none"
          placeholder="••••••••"
        />

        <button
          type="submit"
          disabled={isAuthenticating || keyInput.trim().length === 0}
          className="mt-6 w-full rounded-btn bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isAuthenticating ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};
