import { Navigate, Route, Routes } from 'react-router-dom';

import { AdminAuthProvider } from './context/AdminAuthContext';
import { ToastProvider } from './context/ToastContext';
import { AdminKeyGate } from './components/AdminKeyGate';
import { ToastContainer } from './components/Toast';
import { DashboardPage } from './pages/DashboardPage';
import { AppointmentsListPage } from './pages/AppointmentsListPage';
import { AppointmentDetailPage } from './pages/AppointmentDetailPage';
import { DeadLetterPage } from './pages/DeadLetterPage';

export const App = (): JSX.Element => (
  <ToastProvider>
    <AdminAuthProvider>
      <ToastContainer />
      <AdminKeyGate>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/appointments" element={<AppointmentsListPage />} />
          <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
          <Route path="/dead-letter" element={<DeadLetterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AdminKeyGate>
    </AdminAuthProvider>
  </ToastProvider>
);
