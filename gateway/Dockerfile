# Build context: la raiz del repo (ver docker-compose.yml), no gateway --
# npm workspaces (@clinica/authz) lo exige, ver "build: convertir el repo
# en npm workspaces".
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY packages/authz/package.json ./packages/authz/package.json
RUN npm install --workspace=gateway --workspace=packages/authz --include-workspace-root
COPY packages/authz ./packages/authz
RUN npm run build --workspace=packages/authz

FROM deps AS build
COPY gateway ./gateway
RUN npm run build --workspace=gateway

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY packages/authz/package.json ./packages/authz/package.json
RUN npm install --omit=dev --workspace=gateway --workspace=packages/authz --include-workspace-root
COPY --from=build /app/packages/authz/dist ./packages/authz/dist
COPY --from=build /app/gateway/dist ./gateway/dist
COPY gateway/openapi-specs ./gateway/openapi-specs
WORKDIR /app/gateway
EXPOSE 4000
CMD ["node", "dist/server.js"]
