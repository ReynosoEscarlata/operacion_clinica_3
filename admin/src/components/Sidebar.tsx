import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/appointments', label: 'Citas' },
  { to: '/dead-letter', label: 'Dead Letter' },
];

const linkClassName = ({ isActive }: { isActive: boolean }): string =>
  `block rounded-btn px-4 py-2 text-sm font-medium transition-colors ${
    isActive ? 'border-l-4 border-blue-500 bg-blue-500/20 text-white' : 'text-white/70 hover:text-white'
  }`;

export const Sidebar = (): JSX.Element => (
  <aside className="flex h-screen w-60 flex-col bg-black-900 p-4">
    <h1 className="px-4 py-2 text-lg font-semibold text-white">Clínica</h1>
    <nav className="mt-6 flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === '/'} className={linkClassName}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  </aside>
);
