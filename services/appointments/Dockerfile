# Build context: la raiz del repo (ver docker-compose.yml), no
# services/appointments -- npm workspaces (@clinica/authz) lo exige, ver
# "build: convertir el repo en npm workspaces".
FROM node:20-alpine AS base
WORKDIR /app
# El motor de Prisma necesita OpenSSL; sin esto, Alpine falla a detectarlo
# y el cliente generado no puede ni siquiera conectar.
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY services/appointments/package.json ./services/appointments/package.json
COPY packages/authz/package.json ./packages/authz/package.json
RUN npm install --workspace=services/appointments --workspace=packages/authz --include-workspace-root
COPY packages/authz ./packages/authz
RUN npm run build --workspace=packages/authz
COPY services/appointments/prisma ./services/appointments/prisma
RUN npx prisma generate --schema=services/appointments/prisma/schema.prisma

FROM deps AS build
COPY services/appointments ./services/appointments
RUN npm run build --workspace=services/appointments

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/appointments/package.json ./services/appointments/package.json
COPY packages/authz/package.json ./packages/authz/package.json
RUN npm install --omit=dev --workspace=services/appointments --workspace=packages/authz --include-workspace-root
COPY --from=build /app/packages/authz/dist ./packages/authz/dist
COPY --from=build /app/services/appointments/dist ./services/appointments/dist
COPY services/appointments/prisma ./services/appointments/prisma
RUN npx prisma generate --schema=services/appointments/prisma/schema.prisma
WORKDIR /app/services/appointments
EXPOSE 4002
# Aplica migraciones pendientes antes de arrancar (igual que el monolito en
# CI: `prisma migrate deploy`, nunca `migrate dev` en producción).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
