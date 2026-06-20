import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { ApiError, fetchDashboard } from '../lib/api';

interface AdminAuthContextValue {
  adminKey: string | null;
  isAuthenticating: boolean;
  login: (key: string) => Promise<boolean>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export const AdminAuthProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  // Deliberadamente en memoria (useState), no localStorage/sessionStorage:
  // si se recarga la página, hay que volver a ingresar la key.
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      adminKey,
      isAuthenticating,
      login: async (key: string) => {
        setIsAuthenticating(true);
        try {
          await fetchDashboard(key);
          setAdminKey(key);
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
      logout: () => setAdminKey(null),
    }),
    [adminKey, isAuthenticating],
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
