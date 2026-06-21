import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { ApiError } from '../lib/api';
import { login as loginRequest, type LoginResult } from '../lib/auth';

interface AdminAuthContextValue {
  accessToken: string | null;
  role: string | null;
  isAuthenticating: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export const AdminAuthProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  // Deliberadamente en memoria (useState), no localStorage/sessionStorage:
  // si se recarga la página, hay que volver a ingresar usuario/contraseña.
  // Mismo criterio que la versión anterior (x-admin-key) — solo cambia el
  // mecanismo de autenticación, no esta decisión.
  const [session, setSession] = useState<LoginResult | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      accessToken: session?.accessToken ?? null,
      role: session?.role ?? null,
      isAuthenticating,
      login: async (email: string, password: string) => {
        setIsAuthenticating(true);
        try {
          const result = await loginRequest(email, password);
          setSession(result);
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            return false;
          }
          throw error;
        } finally {
          setIsAuthenticating(false);
        }
      },
      logout: () => setSession(null),
    }),
    [session, isAuthenticating],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
};

export const useAdminAuth = (): AdminAuthContextValue => {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error('useAdminAuth debe usarse dentro de AdminAuthProvider');
  }
  return context;
};
