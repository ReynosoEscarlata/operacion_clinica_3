import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

// Stripe necesita el body crudo (bytes exactos) para verificar la firma del
// webhook — el parseo normal de Fastify ya reconstruye un objeto JS y pierde
// esa representación exacta. Este parser guarda el buffer en request.rawBody
// y además sigue parseando a JSON como siempre, así no afecta a las demás rutas.
export const registerRawBodyCapture = (app: FastifyInstance): void => {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, payload: Buffer, done) => {
      request.rawBody = payload;

      if (payload.length === 0) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(payload.toString('utf8')));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // Sin esto, una request sin body y sin Content-Type (ej. el cliente HTTP
  // de PaymentsClient.cancelPaymentIntent, que hace POST sin mandar
  // ninguno de los dos) daba 415 Unsupported Media Type — lo agarró el
  // contract test de Pact contra la app real, no un mock. Fastify exige un
  // parser para cualquier content-type que no tenga uno registrado
  // explícito, incluido "sin content-type".
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload: Buffer, done) => {
    done(null, payload.length === 0 ? undefined : payload);
  });
};
