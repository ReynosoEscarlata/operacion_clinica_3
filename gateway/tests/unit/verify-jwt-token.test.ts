import { createServer, type Server } from 'node:http';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * verify-jwt.ts construye su JWKS remoto (createRemoteJWKSet) a partir de
 * env.AUTH_JWKS_URL al cargar el módulo — así que antes de importarlo hay
 * que levantar un JWKS real y apuntar la env var ahí. Sirve además como
 * prueba de que la verificación funciona contra un servidor HTTP real, no
 * solo contra un mock en memoria.
 */
let jwksServer: Server;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let kid: string;
let jwksUrl: string;

beforeAll(async () => {
  const { publicKey, privateKey: generatedPrivateKey } = await generateKeyPair('RS256');
  privateKey = generatedPrivateKey;
  kid = 'test-kid';
  const publicJwk = await exportJWK(publicKey);

  jwksServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, resolve));
  const address = jwksServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  jwksUrl = `http://127.0.0.1:${port}/jwks.json`;

  process.env.AUTH_JWKS_URL = jwksUrl;
  process.env.AUTH_SERVICE_URL = 'http://localhost:4001';
  process.env.APPOINTMENTS_SERVICE_URL = 'http://localhost:4002';
  process.env.DOCTORS_SERVICE_URL = 'http://localhost:4003';
  process.env.PAYMENTS_SERVICE_URL = 'http://localhost:4004';
  process.env.NOTIFICATIONS_SERVICE_URL = 'http://localhost:4005';
});

afterAll(() => {
  jwksServer.close();
});

const signToken = async (role: string): Promise<string> =>
  new SignJWT({ role })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

const buildFakeRequestReply = (
  overrides: Partial<FastifyRequest>,
): { request: FastifyRequest; reply: FastifyReply; sendMock: ReturnType<typeof vi.fn> } => {
  const sendMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ send: sendMock });
  const request = {
    method: 'PATCH',
    url: '/v1/appointments/abc/cancel',
    id: 'req-1',
    log: { warn: vi.fn() },
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest;
  const reply = { status: statusMock } as unknown as FastifyReply;
  return { request, reply, sendMock };
};

describe('verifyJwt — token best-effort en rutas públicas', () => {
  it('un token válido de Admin en una ruta pública setea request.user (para reenviar el rol)', async () => {
    const { verifyJwt } = await import('../../src/middleware/verify-jwt.js');
    const token = await signToken('ADMIN');
    const { request, reply, sendMock } = buildFakeRequestReply({
      headers: { authorization: `Bearer ${token}` },
    });

    await verifyJwt(request, reply);

    expect(request.user).toEqual({ sub: 'user-1', role: 'ADMIN' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sin token en una ruta pública no bloquea la request (paciente sin cuenta)', async () => {
    const { verifyJwt } = await import('../../src/middleware/verify-jwt.js');
    const { request, reply, sendMock } = buildFakeRequestReply({ headers: {} });

    await verifyJwt(request, reply);

    expect(request.user).toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('un token inválido en una ruta pública se ignora, no bloquea la request', async () => {
    const { verifyJwt } = await import('../../src/middleware/verify-jwt.js');
    const { request, reply, sendMock } = buildFakeRequestReply({
      headers: { authorization: 'Bearer token-basura' },
    });

    await verifyJwt(request, reply);

    expect(request.user).toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sin token en una ruta protegida responde 401', async () => {
    const { verifyJwt } = await import('../../src/middleware/verify-jwt.js');
    const { request, reply, sendMock } = buildFakeRequestReply({
      method: 'GET',
      url: '/v1/patients',
      headers: {},
    });

    await verifyJwt(request, reply);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    );
  });
});
