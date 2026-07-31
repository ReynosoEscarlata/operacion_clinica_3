import { Navigate, Route, Routes } from 'react-router-dom';

import { AdminAuthProvider } from './context/AdminAuthContext';
import { ToastProvider } from './context/ToastContext';
import { AdminKeyGate } from './components/AdminKeyGate';
import { ToastContainer } from './components/Toast';
import { DashboardPage } from './pages/DashboardPage';
import { PlatformDashboardPage } from './pages/PlatformDashboardPage';
import { AppointmentsListPage } from './pages/AppointmentsListPage';
import { AppointmentDetailPage } from './pages/AppointmentDetailPage';
import { DeadLetterPage } from './pages/DeadLetterPage';
import { HomePage } from './pages/public/HomePage';
import { PatientRegistrationPage } from './pages/public/PatientRegistrationPage';
import { BookingPage } from './pages/public/BookingPage';

// Sub-árbol del panel administrativo: rutas relativas a /admin, detrás de
// AdminAuthProvider/AdminKeyGate (requiere x-admin-key).
const AdminApp = (): JSX.Element => (
  <AdminAuthProvider>
    <AdminKeyGate>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        {/* Fase 6 (ADR-017): sin guard de rol propio en la ruta -- el
            backend (platform_dashboard:read) ya rechaza con 403 a
            cualquier rol de tenant; el ítem del menú además se oculta para
            no ofrecer un enlace que llevaría a un error (ver Sidebar.tsx). */}
        <Route path="/platform" element={<PlatformDashboardPage />} />
        <Route path="/appointments" element={<AppointmentsListPage />} />
        <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
        <Route path="/dead-letter" element={<DeadLetterPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminKeyGate>
  </AdminAuthProvider>
);

export const App = (): JSX.Element => (
  <ToastProvider>
    <ToastContainer />
    <Routes>
      {/* Público: cualquier persona puede acceder, sin x-admin-key */}
      <Route path="/" element={<HomePage />} />
      <Route path="/registro" element={<PatientRegistrationPage />} />
      <Route path="/reservar" element={<BookingPage />} />

      {/* Panel administrativo */}
      <Route path="/admin/*" element={<AdminApp />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </ToastProvider>
);
