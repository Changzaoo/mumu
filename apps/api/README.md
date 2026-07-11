# @aurial/api

Aurial backend — Express 5 + Prisma (PostgreSQL) + Redis/BullMQ + FFmpeg audio pipeline.

## Prerequisites

- Node >= 20, pnpm
- PostgreSQL 16 and Redis 7 (e.g. `docker compose -f ../../infra/docker/docker-compose.dev.yml up -d` if available, or local installs)
- FFmpeg + FFprobe on PATH (or set `FFMPEG_PATH` / `FFPROBE_PATH`)

## Setup

```bash
# from the repo root
cp .env.example apps/api/.env    # then edit values
pnpm install
pnpm --filter @aurial/shared build
pnpm --filter @aurial/api db:generate
pnpm --filter @aurial/api db:migrate   # creates/updates the schema
pnpm --filter @aurial/api db:seed      # rich demo data (idempotent)
```

## Run

```bash
pnpm --filter @aurial/api dev          # API on http://localhost:4000
pnpm --filter @aurial/api dev:worker   # BullMQ workers (audio pipeline)
```

- Health: `GET /healthz`
- OpenAPI/Swagger: `http://localhost:4000/api/docs` (JSON at `/api/docs/openapi.json`)
- Base path: `/api/v1` — success envelope `{ data, meta? }`, errors `{ error: { code, message, details? } }`
- socket.io at path `/ws` (listen-together sessions + notifications)

### Auth in development

With Firebase env vars set, send `Authorization: Bearer <Firebase ID token>`.
If `FIREBASE_PROJECT_ID` is **unset** and `NODE_ENV=development`, the API runs in a
degraded dev mode that accepts `Authorization: Bearer dev:<any-uid>` (a loud warning
is logged at startup). Seeded demo users have firebase uids `seed-user-1..3`, so
`Bearer dev:seed-user-1` logs you in as the demo user.

## Tests

```bash
pnpm --filter @aurial/api test        # vitest unit tests (no DB/Redis needed)
pnpm --filter @aurial/api typecheck
```

## Production

- Docker: built by `infra/docker/docker-compose.prod.yml` (multi-stage `Dockerfile` here, ffmpeg included). API listens on `:4000`; worker runs `dist/workers/index.js`.
- PM2 (bare metal): `pnpm build && pm2 start ecosystem.config.cjs`.
