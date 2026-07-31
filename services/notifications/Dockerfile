# Build context: la raiz del repo (ver docker-compose.yml), no
# services/notifications -- npm workspaces (@clinica/authz) lo exige, ver
# "build: convertir el repo en npm workspaces".
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY services/notifications/package.json ./services/notifications/package.json
COPY packages/authz/package.json ./packages/authz/package.json
COPY packages/messaging/package.json ./packages/messaging/package.json
RUN npm install --workspace=services/notifications --workspace=packages/authz --workspace=packages/messaging --include-workspace-root
COPY packages/authz ./packages/authz
COPY packages/messaging ./packages/messaging
RUN npm run build --workspace=packages/authz
RUN npm run build --workspace=packages/messaging
COPY services/notifications/prisma ./services/notifications/prisma
RUN npx prisma generate --schema=services/notifications/prisma/schema.prisma

FROM deps AS build
COPY services/notifications ./services/notifications
RUN npm run build --workspace=services/notifications

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/notifications/package.json ./services/notifications/package.json
COPY packages/authz/package.json ./packages/authz/package.json
COPY packages/messaging/package.json ./packages/messaging/package.json
RUN npm install --omit=dev --workspace=services/notifications --workspace=packages/authz --workspace=packages/messaging --include-workspace-root
COPY --from=build /app/packages/authz/dist ./packages/authz/dist
COPY --from=build /app/packages/messaging/dist ./packages/messaging/dist
COPY --from=build /app/services/notifications/dist ./services/notifications/dist
COPY services/notifications/prisma ./services/notifications/prisma
RUN npx prisma generate --schema=services/notifications/prisma/schema.prisma
WORKDIR /app/services/notifications
EXPOSE 4005
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
