# Build context: la raiz del repo (ver docker-compose.yml), no
# services/doctors -- npm workspaces (@clinica/authz) lo exige, ver
# "build: convertir el repo en npm workspaces".
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY services/doctors/package.json ./services/doctors/package.json
COPY packages/authz/package.json ./packages/authz/package.json
RUN npm install --workspace=services/doctors --workspace=packages/authz --include-workspace-root
COPY packages/authz ./packages/authz
RUN npm run build --workspace=packages/authz
COPY services/doctors/prisma ./services/doctors/prisma
RUN npx prisma generate --schema=services/doctors/prisma/schema.prisma

FROM deps AS build
COPY services/doctors ./services/doctors
RUN npm run build --workspace=services/doctors

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/doctors/package.json ./services/doctors/package.json
COPY packages/authz/package.json ./packages/authz/package.json
RUN npm install --omit=dev --workspace=services/doctors --workspace=packages/authz --include-workspace-root
COPY --from=build /app/packages/authz/dist ./packages/authz/dist
COPY --from=build /app/services/doctors/dist ./services/doctors/dist
COPY services/doctors/prisma ./services/doctors/prisma
RUN npx prisma generate --schema=services/doctors/prisma/schema.prisma
WORKDIR /app/services/doctors
EXPOSE 4003
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
