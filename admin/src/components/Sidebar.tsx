import { NavLink } from 'react-router-dom';

import { useAdminAuth } from '../context/AdminAuthContext';

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/appointments', label: 'Citas' },
  { to: '/admin/dead-letter', label: 'Dead Letter' },
];

// Fase 6 (ADR-017): plano de plataforma (RFC-004) -- oculto para cualquier
// rol de tenant, mismo criterio de dos planos que ya separa /v1/platform de
// /v1/admin en el backend.
const PLATFORM_ROLES = new Set(['platform_admin', 'platform_support']);

const linkClassName = ({ isActive }: { isActive: boolean }): string =>
  `block rounded-btn px-4 py-2 text-sm font-medium transition-colors ${
    isActive ? 'border-l-4 border-blue-500 bg-blue-500/20 text-white' : 'text-white/70 hover:text-white'
  }`;

export const Sidebar = (): JSX.Element => {
  const { role } = useAdminAuth();
  const navItems = role && PLATFORM_ROLES.has(role) ? [...NAV_ITEMS, { to: '/admin/platform', label: 'Plataforma' }] : NAV_ITEMS;

  return (
    <aside className="flex h-screen w-60 flex-col bg-black-900 p-4">
      <h1 className="px-4 py-2 text-lg font-semibold text-white">Clínica</h1>
      <nav className="mt-6 flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/admin'} className={linkClassName}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};
