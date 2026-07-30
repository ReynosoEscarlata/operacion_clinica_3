# Build context: la raiz del repo (ver docker-compose.yml), no
# services/payments -- npm workspaces (@clinica/authz) lo exige, ver
# "build: convertir el repo en npm workspaces".
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY services/payments/package.json ./services/payments/package.json
COPY packages/authz/package.json ./packages/authz/package.json
RUN npm install --workspace=services/payments --workspace=packages/authz --include-workspace-root
COPY packages/authz ./packages/authz
RUN npm run build --workspace=packages/authz
COPY services/payments/prisma ./services/payments/prisma
RUN npx prisma generate --schema=services/payments/prisma/schema.prisma

FROM deps AS build
COPY services/payments ./services/payments
RUN npm run build --workspace=services/payments

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/payments/package.json ./services/payments/package.json
COPY packages/authz/package.json ./packages/authz/package.json
RUN npm install --omit=dev --workspace=services/payments --workspace=packages/authz --include-workspace-root
COPY --from=build /app/packages/authz/dist ./packages/authz/dist
COPY --from=build /app/services/payments/dist ./services/payments/dist
COPY services/payments/prisma ./services/payments/prisma
RUN npx prisma generate --schema=services/payments/prisma/schema.prisma
WORKDIR /app/services/payments
EXPOSE 4004
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
