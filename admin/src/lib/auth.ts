import { ApiError } from './api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  role: string | null;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

interface JwtPayload {
  role?: string;
}

// El rol no viaja en el body de /v1/auth/login (solo accessToken/refreshToken
// /expiresIn) — vive en el payload del JWT (ver gateway/src/middleware/verify-jwt.ts).
// Esto es solo para mostrarlo en la UI; el gateway es quien valida la firma
// en cada request, este decode no es una verificación de seguridad.
const decodeRole = (jwt: string): string | null => {
  try {
    const payloadSegment = jwt.split('.')[1];
    if (!payloadSegment) return null;
    const json = atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as JwtPayload;
    return payload.role ?? null;
  } catch {
    return null;
  }
};

export const login = async (email: string, password: string): Promise<LoginResult> => {
  const response = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const envelope = (data ?? {}) as ErrorEnvelope;
    throw new ApiError(
      response.status,
      envelope.error?.code ?? 'UNKNOWN_ERROR',
      envelope.error?.message ?? 'No se pudo iniciar sesión',
    );
  }

  const { accessToken, refreshToken } = data as LoginResponse;
  return { accessToken, refreshToken, role: decodeRole(accessToken) };
};
