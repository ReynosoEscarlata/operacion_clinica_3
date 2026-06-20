import { useState, type ReactNode } from 'react';

import { Sidebar } from './Sidebar';

interface LayoutProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

export const Layout = ({ title, actions, children }: LayoutProps): JSX.Element => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <Sidebar />
          <div
            className="flex-1 bg-black-900/50"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        </div>
      )}

      <div className="flex-1 bg-ice">
        <header className="flex items-center justify-between border-b border-black-300 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Abrir menú"
              className="text-black-900 md:hidden"
            >
              ☰
            </button>
            <h2 className="text-xl font-bold text-black-900">{title}</h2>
          </div>
          {actions}
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
};
