import type { FastifyInstance, FastifyRequest } from 'fastify';

import { TENANT_ID_HEADER } from '../lib/constants.js';
import { tenantContextStorage } from '../lib/tenant-context.js';

// A diferencia de Auth/Doctors/Appointments, este middleware NUNCA rechaza
// una request por falta del header: Payments no se sienta detrás del
// gateway para todo su tráfico (Appointments lo llama directo,
// servicio-a-servicio, sin pasar por ahí) y Stripe llama a
// /v1/webhooks/stripe sin JWT ni header alguno. El tenant es contexto
// opcional que, si está presente, se usa para enriquecer el metadata del
// PaymentIntent (ver payments.controller.ts) -- nunca para autorizar o
// filtrar una consulta.
export const registerTenantContext = (app: FastifyInstance): void => {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const incoming = request.headers[TENANT_ID_HEADER];
    const tenantId = Array.isArray(incoming) ? incoming[0] : incoming;
    tenantContextStorage.enterWith({ tenantId: tenantId ?? null });
  });
};
