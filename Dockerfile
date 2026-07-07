FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS builder
ARG APP_VERSION=0.1.23
ENV PCP_VERSION=$APP_VERSION
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ARG APP_VERSION=0.1.23
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PCP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.title="personal-context-protocol" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.description="Scoped AI session recording app"

COPY package.json package-lock.json VERSION ./
COPY scripts/project-version.js scripts/runtime-check.js scripts/deploy-init.js ./scripts/
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next

EXPOSE 3000
CMD ["npm", "run", "start"]
