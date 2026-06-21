FROM node:20-alpine AS base
WORKDIR /app
# El motor de Prisma necesita OpenSSL; sin esto, Alpine falla a detectarlo
# y el cliente generado no puede ni siquiera conectar.
RUN apk add --no-cache openssl

FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm install && npx prisma generate

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 4002
# Aplica migraciones pendientes antes de arrancar (igual que el monolito en
# CI: `prisma migrate deploy`, nunca `migrate dev` en producción).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
