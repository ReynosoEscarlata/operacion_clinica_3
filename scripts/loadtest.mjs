// Script de carga ligero (PLAN.md Fase 4, punto 2): genera tráfico real
// contra el gateway para tener datos reales en los dashboards de Grafana
// durante la demo — sin esto, las métricas RED quedan en cero y no hay
// nada que mostrar. Usa autocannon (no k6: no requiere instalar un binario
// aparte, alcanza con `npx` en este monorepo Node).
//
// Simula un flujo realista mezclando rutas públicas (reserva), rutas de
// admin (dashboard) y un login real — cada conexión hace su propio login
// una vez y reusa el token para las rutas protegidas del resto del ciclo.
//
// Uso: node scripts/loadtest.mjs [duracionSegundos] [conexiones]
import autocannon from 'autocannon';

const BASE_URL = process.env.LOADTEST_BASE_URL ?? 'http://localhost:4000';
const ADMIN_EMAIL = process.env.LOADTEST_ADMIN_EMAIL ?? 'admin-demo@clinica.test';
const ADMIN_PASSWORD = process.env.LOADTEST_ADMIN_PASSWORD ?? 'demo-password-123';

const duration = Number(process.argv[2] ?? 30);
const connections = Number(process.argv[3] ?? 10);

const requests = [
  // Pública: sondea salud del gateway (sin auth).
  { method: 'GET', path: '/healthz' },
  // Pública: navegación de doctores, la pega más pesada del flujo de
  // reserva (lo que más usaría un paciente real).
  { method: 'GET', path: '/v1/doctors' },
  // Login real — guarda el accessToken en el contexto de la conexión para
  // las siguientes 2 requests del ciclo.
  {
    method: 'POST',
    path: '/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    onResponse: (status, body, context) => {
      if (status !== 200) return;
      try {
        context.accessToken = JSON.parse(body).accessToken;
      } catch {
        // Login falló (ej. credenciales no seedeadas en este ambiente) —
        // las rutas de admin del ciclo van a dar 401, que es información
        // real también (se ve en el dashboard como error rate).
      }
    },
  },
  // Admin: dashboard agregado de Appointments.
  {
    method: 'GET',
    path: '/v1/admin/dashboard',
    setupRequest: (request, context) => ({
      ...request,
      headers: { ...request.headers, authorization: `Bearer ${context.accessToken ?? ''}` },
    }),
  },
  // Admin: lista de citas paginada.
  {
    method: 'GET',
    path: '/v1/appointments',
    setupRequest: (request, context) => ({
      ...request,
      headers: { ...request.headers, authorization: `Bearer ${context.accessToken ?? ''}` },
    }),
  },
];

const instance = autocannon(
  {
    url: BASE_URL,
    connections,
    duration,
    requests,
  },
  (err, result) => {
    if (err) {
      console.error('Error en el load test:', err);
      process.exitCode = 1;
      return;
    }
    console.log(autocannon.printResult(result));
  },
);

autocannon.track(instance, { renderProgressBar: true });
