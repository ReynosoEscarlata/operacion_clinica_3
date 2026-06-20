import { Link } from 'react-router-dom';

import { PublicLayout } from '../../components/PublicLayout';

export const HomePage = (): JSX.Element => (
  <PublicLayout title="Bienvenido a Clínica" subtitle="Reservá tu cita médica en minutos.">
    <div className="flex flex-col gap-3">
      <Link
        to="/reservar"
        className="rounded-btn bg-blue-500 px-4 py-3 text-center text-sm font-medium text-white hover:bg-blue-700"
      >
        Reservar una cita
      </Link>
      <Link
        to="/registro"
        className="rounded-btn border border-black-300 px-4 py-3 text-center text-sm font-medium text-black-900 hover:bg-ice"
      >
        Crear mi registro de paciente
      </Link>
    </div>

    <p className="mt-8 text-center text-xs text-black-600">
      ¿Trabajás en la clínica?{' '}
      <Link to="/admin" className="text-blue-500 hover:text-blue-700">
        Ingresá al panel administrativo
      </Link>
    </p>
  </PublicLayout>
);
