# Aurial — Architecture

> **Aurial** is a professional music streaming platform: minimal, glass, elegant, fast.
> This document is the single source of truth for architecture decisions and conventions.
> Every contributor (human or agent) must follow it.

## 1. Monorepo layout

```
aurial/
├── apps/
│   ├── web/          # React 19 + Vite + TS — deployed to Vercel
│   └── api/          # Node 22 + Express 5 + Prisma — deployed to Linux VPS (Docker + PM2)
├── packages/
│   └── shared/       # @aurial/shared — Zod schemas, DTO types, constants (used by web + api)
├── infra/            # docker-compose, nginx, pm2, deploy scripts
├── docs/             # architecture, design, api docs
└── .github/          # CI/CD workflows
```

- Package manager: **pnpm workspaces**. Node >= 20.
- All packages are **ESM** (`"type": "module"`).
- TypeScript **strict** everywhere; every package extends `tsconfig.base.json`.
- Workspace deps use `"@aurial/shared": "workspace:*"`.

## 2. Why these choices (decision log)

| Decision                    | Rationale                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monorepo (pnpm)             | Shared DTOs/Zod schemas between web and api = one contract, zero drift.                                                                                |
| Express 5 + layered modules | Team familiarity, huge ecosystem; Clean Architecture gives testability without framework lock-in.                                                      |
| Prisma + PostgreSQL         | Type-safe data layer, migrations as code, best-in-class DX.                                                                                            |
| Redis + BullMQ              | Cache + durable job queue for FFmpeg processing (transcode, waveform, loudness).                                                                       |
| Firebase Auth               | Offloads identity (Google/Apple/GitHub/email/anonymous/magic-link/2FA); API verifies ID tokens with `firebase-admin`, no password storage on our side. |
| Cloudflare R2 (S3 API)      | Zero egress fees — critical for audio streaming economics. Supabase Storage is a drop-in alt via the same `StorageProvider` interface.                 |
| HLS via FFmpeg              | Adaptive bitrate streaming (AAC 96/160/320) + original lossless kept for FLAC sources.                                                                 |
| Vercel (web) + VPS (api)    | Static edge for the SPA; full control of FFmpeg/PM2/nginx on the VPS.                                                                                  |

## 3. Backend — Clean Architecture

```
apps/api/src/
├── main.ts                  # bootstrap (http server)
├── app.ts                   # express app factory (usable in tests)
├── config/                  # env parsing (Zod-validated), constants
├── core/                    # framework-agnostic building blocks
│   ├── errors/              # AppError hierarchy (NotFoundError, ForbiddenError, ...)
│   ├── http/                # asyncHandler, ApiResponse envelope, pagination helpers
│   ├── events/              # typed EventBus (domain events)
│   └── logger.ts            # pino
├── infra/
│   ├── db/                  # prisma client singleton
│   ├── redis/               # ioredis client + cache service (get/set/invalidate, key builders)
│   ├── queue/               # BullMQ queues + worker bootstrap
│   ├── storage/             # StorageProvider interface + R2/S3 + local-disk impls
│   ├── firebase/            # firebase-admin init, token verification
│   └── ffmpeg/              # ffmpeg command builders (transcode, hls, waveform, loudness, cover)
├── middlewares/             # auth, requireRole, rateLimit, validate(zod), errorHandler, requestId
├── modules/<domain>/        # one folder per bounded context
│   ├── <domain>.routes.ts       # express Router; route → controller
│   ├── <domain>.controller.ts   # HTTP only: parse/validate → service → respond
│   ├── <domain>.service.ts      # business logic; throws AppError; emits events
│   ├── <domain>.repository.ts   # Prisma queries ONLY (no logic)
│   └── <domain>.docs.ts         # OpenAPI path registrations (zod-to-openapi)
├── workers/                 # BullMQ processors: audio-process, waveform, import-sync, notifications
└── docs/                    # swagger setup (serves /api/docs)
```

**Modules:** `auth`, `users`, `artists`, `albums`, `tracks`, `playlists`, `library`, `search`, `uploads`, `stream`, `history`, `social`, `podcasts`, `radios`, `recommendations`, `admin`, `analytics`, `imports`.

**Rules**

- Controllers never touch Prisma. Services never touch `req`/`res`. Repositories never contain business rules.
- All input validated with Zod schemas from `@aurial/shared` via `validate({ body?, query?, params? })` middleware.
- All responses use the envelope: `{ data, meta? }` for success; errors: `{ error: { code, message, details? } }`.
- Pagination: cursor-based (`?cursor=&limit=`) → `meta: { nextCursor, hasMore }`. Offset mode (`?page=&perPage=`) only on admin tables.
- IDs: `cuid()` strings from Prisma.
- Auth middleware populates `req.user = { id, firebaseUid, role }`. `requireAuth` → 401; `requireRole('ADMIN' | 'MODERATOR')` → 403.
- Rate limits: global 300 req/min/IP; auth endpoints 20/min; uploads 10/hour (via `rate-limit-redis`).
- Every module exports its router from `modules/<domain>/index.ts`; `app.ts` mounts under `/api/v1`.

## 4. API surface (v1) — contract

Base: `/api/v1`. Auth: `Authorization: Bearer <Firebase ID token>`. Envelope as above.

| Area            | Endpoints                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth            | `POST /auth/session` (verify token, upsert user, return profile) · `DELETE /auth/session`                                                                                     |
| users           | `GET/PATCH /me` · `GET /users/:id` · `GET /users/:id/playlists` · `POST/DELETE /users/:id/follow` · `GET /me/stats`                                                           |
| artists         | `GET /artists` · `GET /artists/:id` · `GET /artists/:id/top-tracks` · `GET /artists/:id/albums` · `GET /artists/:id/related` · `POST/DELETE /artists/:id/follow`              |
| albums          | `GET /albums` · `GET /albums/:id` (includes tracks) · `GET /albums/new-releases`                                                                                              |
| tracks          | `GET /tracks/:id` · `GET /tracks/:id/waveform` · `GET /tracks/:id/lyrics`                                                                                                     |
| playlists       | `GET/POST /playlists` · `GET/PATCH/DELETE /playlists/:id` · `POST/DELETE /playlists/:id/tracks` · `PATCH /playlists/:id/tracks/reorder` · `POST /playlists/:id/collaborators` |
| library         | `GET /me/library` · `PUT/DELETE /me/library/tracks/:id` (like) · `PUT/DELETE /me/library/albums/:id` · `PUT/DELETE /me/library/artists/:id` · `GET /me/library/liked-tracks`  |
| history         | `POST /me/history` (play event: trackId, ms, source) · `GET /me/history` · `GET /me/history/recent` (continue listening)                                                      |
| search          | `GET /search?q=&type=&limit=` (grouped) · `GET /search/suggest?q=` (autocomplete)                                                                                             |
| home            | `GET /home` (sections: continue-listening, recommended, new-releases, recently-played, moods, trending)                                                                       |
| uploads         | `POST /uploads` (multipart audio) → job id · `GET /uploads/:id/status` · `GET /me/uploads` · `DELETE /uploads/:id`                                                            |
| imports         | `POST /imports/cloud` (provider, oauth handle) · `GET /imports/:id/status`                                                                                                    |
| stream          | `GET /stream/:trackId/manifest.m3u8` · `GET /stream/:trackId/:quality/:segment` (signed URLs / token query)                                                                   |
| podcasts        | `GET /podcasts` · `GET /podcasts/:id` · `GET /podcasts/:id/episodes`                                                                                                          |
| radios          | `GET /radios` · `GET /radios/:id`                                                                                                                                             |
| recommendations | `GET /recs/daily-mix` · `GET /recs/discover` · `GET /recs/mood/:mood` · `GET /recs/track-radio/:trackId`                                                                      |
| social          | `GET /feed` · `POST /tracks/:id/comments` · `GET /tracks/:id/comments` · `POST /sessions` (listen-together, WS)                                                               |
| admin           | `GET /admin/stats` · `GET/PATCH /admin/users` · `GET /admin/uploads` · `GET /admin/jobs` · `GET /admin/logs` · `POST /admin/users/:id/ban`                                    |

OpenAPI 3.1 generated from the Zod schemas (`@asteasolutions/zod-to-openapi`), served at `/api/docs` (Swagger UI) + `/api/docs/openapi.json`.

## 5. Audio pipeline (FFmpeg + BullMQ)

Upload flow:

1. `POST /uploads` streams file to storage (`uploads/raw/<id>`), creates `Upload` row (`status: QUEUED`), enqueues `audio-process` job.
2. Worker `audio-process`:
   - `ffprobe` → validate + extract metadata (title, artist, album, duration, codec) and embedded cover art.
   - Loudness scan (`loudnorm` pass 1) → integrated LUFS + true peak → stored for **ReplayGain**.
   - Transcode → HLS ladder: AAC 96k / 160k / 320k (`master.m3u8` + segments) uploaded to `audio/<trackId>/`.
   - Waveform peaks: PCM decode → 1024 normalized peaks → JSON stored on `Track.waveform`.
   - Cover → WebP 64/300/1200 via `sharp`.
   - Creates `Track` (+ Artist/Album upsert by metadata), marks `Upload.status: READY`. Emits `track.processed`.
3. Progress is written to Redis (`upload:<id>:progress`) — the status endpoint polls it.

Gapless/crossfade are client concerns (see player engine) — the API guarantees exact `durationMs` and LUFS data.

## 6. Realtime

- `socket.io` on the API (path `/ws`): listen-together sessions (join/leave/sync playback position), notifications, friend activity feed. Auth via Firebase token on handshake.

## 7. Caching strategy (Redis)

| Key                        | TTL    | Invalidation                |
| -------------------------- | ------ | --------------------------- |
| `home:<userId>`            | 10 min | on new history entry (lazy) |
| `artist:<id>` `album:<id>` | 1 h    | on admin/content mutation   |
| `search:<hash(q,type)>`    | 5 min  | TTL only                    |
| `recs:*`                   | 6 h    | nightly worker refresh      |
| `ratelimit:*`              | window | —                           |

## 8. Security

- `helmet`, strict CORS allowlist (`WEB_ORIGIN`), JSON body limit 1mb (uploads use multipart streaming).
- Firebase ID token verification on every authenticated route (cached public keys).
- Zod validation on 100% of inputs; Prisma = parameterized queries (no SQL injection).
- Signed, short-lived stream tokens (HMAC, 6h) — audio URLs are not permanently public.
- Rate limiting (Redis-backed), request IDs, structured audit logs (pino) for admin actions.
- File uploads: extension + magic-bytes sniffing (`file-type`), size caps, ffprobe validation before processing.

## 9. Frontend architecture

```
apps/web/src/
├── main.tsx / App.tsx        # providers: Router, QueryClient, Theme, Auth
├── app/
│   ├── router.tsx             # createBrowserRouter, lazy routes
│   └── layout/                # AppShell, Sidebar, TopBar, PlayerBar, QueuePanel, MobileNav
├── components/
│   ├── ui/                    # shadcn-style primitives (Button, Input, Dialog, DropdownMenu, Slider, Tabs, Tooltip, Sheet, Skeleton, ...)
│   └── media/                 # TrackRow, MediaCard, ArtistCard, PlaylistCard, SectionCarousel, WaveformCanvas, LikeButton, PlayButton
├── features/<domain>/         # api hooks + components per domain (home, search, library, playlist, artist, album, player, settings, profile, admin, podcasts, radios)
├── stores/                    # zustand: playerStore, queueStore, settingsStore, uiStore
├── lib/
│   ├── api.ts                 # typed fetch client (envelope-aware, auth header, errors)
│   ├── audio/                 # AudioEngine (Howler + WebAudio graph: EQ, analyser, crossfade, gapless preload)
│   ├── firebase.ts            # firebase web SDK init
│   └── utils.ts               # cn(), formatDuration(), etc.
├── hooks/                     # useMediaSession, useKeyboardShortcuts, useInfiniteScroll, ...
├── pages/                     # route components (thin — compose features)
└── styles/                    # globals.css (tokens), themes
```

**Rules**

- Server state = TanStack Query only (`queryKey` conventions: `['artist', id]`, `['home']`...). Client state = Zustand. Never duplicate server data in stores.
- Forms = react-hook-form + zodResolver with schemas from `@aurial/shared`.
- Routes lazy-loaded; lists > 50 items virtualized (`@tanstack/react-virtual`).
- Player is global and never unmounts; routing changes must not interrupt audio.
- Media Session API for OS-level controls; keyboard shortcuts (space, ←/→ seek, ↑/↓ volume, etc.).
- PWA via `vite-plugin-pwa`: offline shell, runtime caching of covers, installable.

## 10. Player engine contract

`lib/audio/AudioEngine.ts` — singleton class wrapping Howler + Web Audio:

- `load(track, { autoplay })`, `play()`, `pause()`, `seek(sec)`, `setVolume(0..1)`, `setRate(0.5..2)`
- Gapless: preloads next queue item at `duration - 12s`; crossfade N seconds (settings) using dual Howl instances.
- ReplayGain: applies gain from track LUFS (target −14 LUFS) via GainNode.
- 10-band EQ (BiquadFilterNodes) + AnalyserNode exposed for spectrum/visualizer.
- Emits typed events: `timeupdate`, `ended`, `loaded`, `error` → consumed by `playerStore`.

`playerStore` (zustand): `currentTrack, queue, queueIndex, isPlaying, progress, duration, volume, repeat ('off'|'all'|'one'), shuffle, playTrack(track, context), playQueue(tracks, index), next(), prev(), toggle(), seek(), setVolume(), toggleShuffle(), cycleRepeat(), addToQueue(), playNext(), removeFromQueue(), reorderQueue()`.

## 11. Testing & quality

- **Vitest** for unit tests (api services with mocked repos; web components with Testing Library; shared schemas).
- **Playwright** e2e smoke (web): app loads, navigation, player mounts.
- ESLint flat config + Prettier + Husky (`pre-commit`: lint-staged; `commit-msg`: commitlint).
- CI (GitHub Actions): install → lint → typecheck → test → build, per-package caching.

## 12. Environments

All env vars documented in `.env.example` (root) — API reads its own validated copy via `src/config/env.ts` (Zod). Web uses `VITE_*` vars only.
