# ShadowCrypts Predictions: one image for the website and the forecast refresher.
# The data the app writes (ESPN caches and the forecast ledger) lives in /app/.cache,
# which should be a persistent volume so the track record survives restarts.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Dev dependencies stay: the refresher and warm scripts run through tsx.
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/.cache && chown node:node /app/.cache
USER node
VOLUME /app/.cache
EXPOSE 3000
# Inside a container the server has to listen on every interface for the port mapping to reach it;
# docker-compose.yml decides which of the host's addresses that mapping uses.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
