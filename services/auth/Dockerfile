# Build context: la raiz del repo (ver docker-compose.yml), no
# services/auth -- npm workspaces (@clinica/authz) lo exige, ver
# "build: convertir el repo en npm workspaces".
FROM node:20-alpine AS base
WORKDIR /app
# El motor de Prisma necesita OpenSSL; sin esto, Alpine falla a detectarlo
# y el cliente generado no puede ni siquiera conectar.
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY services/auth/package.json ./services/auth/package.json
COPY packages/authz/package.json ./packages/authz/package.json
COPY packages/messaging/package.json ./packages/messaging/package.json
RUN npm install --workspace=services/auth --workspace=packages/authz --workspace=packages/messaging --include-workspace-root
COPY packages/authz ./packages/authz
COPY packages/messaging ./packages/messaging
RUN npm run build --workspace=packages/authz
RUN npm run build --workspace=packages/messaging
COPY services/auth/prisma ./services/auth/prisma
RUN npx prisma generate --schema=services/auth/prisma/schema.prisma

FROM deps AS build
COPY services/auth ./services/auth
RUN npm run build --workspace=services/auth

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/auth/package.json ./services/auth/package.json
COPY packages/authz/package.json ./packages/authz/package.json
COPY packages/messaging/package.json ./packages/messaging/package.json
RUN npm install --omit=dev --workspace=services/auth --workspace=packages/authz --workspace=packages/messaging --include-workspace-root
COPY --from=build /app/packages/authz/dist ./packages/authz/dist
COPY --from=build /app/packages/messaging/dist ./packages/messaging/dist
COPY --from=build /app/services/auth/dist ./services/auth/dist
COPY services/auth/prisma ./services/auth/prisma
RUN npx prisma generate --schema=services/auth/prisma/schema.prisma
WORKDIR /app/services/auth
EXPOSE 4001
# Aplica migraciones pendientes antes de arrancar (igual que el monolito en
# CI: `prisma migrate deploy`, nunca `migrate dev` en producción).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
