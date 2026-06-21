import { useState, type FormEvent, type ReactNode } from 'react';

import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';

export const AdminKeyGate = ({ children }: { children: ReactNode }): JSX.Element => {
  const { accessToken, isAuthenticating, login } = useAdminAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (accessToken) {
    return <>{children}</>;
  }

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!email.trim() || !password) return;

    const success = await login(email.trim(), password);
    if (!success) {
      showToast('Email o contraseña incorrectos', 'error');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ice p-4">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-sm rounded-modal bg-white p-8 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-black-900">Clínica — Panel administrativo</h1>
        <p className="mt-1 text-sm text-black-600">Ingresá con tu cuenta de staff o admin para continuar.</p>

        <label htmlFor="email" className="mt-6 block text-sm font-medium text-black-900">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900 focus:border-blue-500 focus:outline-none"
          placeholder="admin@clinica.test"
        />

        <label htmlFor="password" className="mt-4 block text-sm font-medium text-black-900">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-btn border border-black-300 px-3 py-2 text-sm text-black-900 focus:border-blue-500 focus:outline-none"
          placeholder="••••••••"
        />

        <button
          type="submit"
          disabled={isAuthenticating || !email.trim() || !password}
          className="mt-6 w-full rounded-btn bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isAuthenticating ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};
