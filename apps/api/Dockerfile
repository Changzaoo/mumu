# syntax=docker/dockerfile:1
# Build context = repo root (infra/docker/docker-compose.prod.yml sets context: ../../).
# Same image serves both `api` (dist/main.js) and `worker` (dist/workers/index.js).

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ── build: install workspace subset, build shared + api ────────────────
FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
# openssl needed by prisma generate engines on slim images
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile --filter "@aurial/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @aurial/shared build \
  && pnpm --filter @aurial/api db:generate \
  && pnpm --filter @aurial/api build

# ── runtime: node + ffmpeg + yt-dlp ─────────────────────────────────────
# Dev deps are kept on purpose: the compose `migrate` one-shot runs
# `npx prisma migrate deploy` inside this same image and needs the prisma CLI.
# yt-dlp is the standalone (self-contained) Linux binary — used ONLY by the
# self-hosted link importer, which is gated behind LINK_IMPORT_ENABLED.
FROM node:22-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates wget \
  && wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -O /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get purge -y wget && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
