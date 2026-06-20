import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface PublicLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export const PublicLayout = ({ title, subtitle, children }: PublicLayoutProps): JSX.Element => (
  <div className="min-h-screen bg-ice">
    <header className="border-b border-black-300 bg-white px-6 py-4">
      <Link to="/" className="text-lg font-semibold text-black-900">
        Clínica
      </Link>
    </header>

    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="rounded-card border border-black-300 bg-white p-8">
        <h1 className="text-xl font-bold text-black-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-black-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  </div>
);
