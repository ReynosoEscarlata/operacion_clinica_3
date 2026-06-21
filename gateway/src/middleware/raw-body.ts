import type { FastifyInstance } from 'fastify';

// @fastify/http-proxy reenvía request.body al upstream. Si Fastify ya
// parseó el JSON (comportamiento default), el proxy tiene que volver a
// serializarlo para reenviarlo — y ese JSON.stringify casi nunca produce
// los mismos bytes que el body original (espacios, orden de claves), pero
// el header Content-Length que se reenvía SÍ es el original. El upstream
// (cada microservicio) rechaza eso con
// FST_ERR_CTP_INVALID_CONTENT_LENGTH. La solución: el gateway no parsea
// el body en absoluto, lo pasa como Buffer crudo — bytes idénticos, mismo
// Content-Length.
export const registerRawBodyPassthrough = (app: FastifyInstance): void => {
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload, done) => {
    done(null, payload);
  });
};
