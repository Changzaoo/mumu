# 00 — Contexto do projeto

Monorepo **pnpm** (`radinho` / aurial.vercel.app). Node >= 20, pnpm 10.4.1, TypeScript 5.7, ESM.

## Estrutura (3 níveis, sem node_modules/.git/dist)

```
apps/
  web/        React 19 + Vite 6 + Tailwind v4 + PWA + Capacitor (android/)
    src/{app,components,features,hooks,lib,pages,stores,styles,test}
    e2e/, public/, android/
  api/        Express 5 + Prisma 6 + BullMQ (src/{modules,core,workers,realtime,infra})
  importer/   binários yt-dlp/ffmpeg, proto/, blobs/ (servidor externo)
  signaling/  WebRTC signaling (P2P)
packages/shared/  schemas zod, constants, utils, ai
infra/      docker, nginx, pm2, systemd, scripts
docs/, .github/workflows/, firestore.rules, vercel.json
```

## Stack e versões-chave

- **web**: react 19, vite 6, zustand 5, @tanstack/react-query 5, react-router 7,
  **howler 2.2.4**, **hls.js 1.5.20**, **wavesurfer.js 7.9**, firebase 11,
  socket.io-client 4.8, framer-motion 12, radix-ui, zod 3.
- **api**: express 5, prisma 6.2, bullmq 5.34, @aws-sdk/client-s3, redis (ioredis ^5.11.1 via override).
- **shared**: workspace:\* consumido por web e api.

## Scripts

| Alvo      | Comando                                                                   |
| --------- | ------------------------------------------------------------------------- |
| dev       | `pnpm dev` (paralelo) / `pnpm dev:web` / `pnpm dev:api`                   |
| build     | `pnpm build` (`-r`); web = `tsc -b && vite build`                         |
| typecheck | `pnpm typecheck`                                                          |
| test      | `pnpm test` (vitest run por pacote)                                       |
| e2e       | `pnpm e2e` (playwright)                                                   |
| perf      | web: `pnpm perf`, `pnpm perf:memoria` (configs playwright dedicadas)      |
| lint      | `pnpm lint` — **quebrado de base (~7767 problemas), não serve de portão** |
| db        | `db:generate` / `db:migrate` / `db:seed` (prisma)                         |

## Pontos de entrada

- Web: `apps/web/src/main.tsx` → `App.tsx` → `src/app/router.tsx` + `RootLayout.tsx`, `pwa.ts`.
- API: `apps/api/src/main.ts` → `app.ts`; workers em `src/workers/index.ts`.

## Onde fica o quê (reprodução de música)

- **Motor de áudio**: `apps/web/src/lib/audio/AudioEngine.ts` (1085 linhas) + `mediaSession.ts`.
- **Estado do player**: `apps/web/src/stores/playerStore.ts` (1827 linhas) — fila, repeat,
  shuffle, crossfade, watchdog.
- **UI do player**: `src/components/ui/{PlayerBar,MiniPlayer,NowPlaying,QueuePanel}.tsx`,
  `src/components/media/{SeekSlider,WaveformSeeker,SpectrumVisualizer,EqualizerPanel,PlayButton}.tsx`.
- **Fontes de faixa**: `src/lib/catalog/`, `src/lib/local/` (cofre local, importQueue,
  validateAudio, playbackDiagnosis, reparador, faixasQueFalharam), `src/lib/offline/`
  (audioCache, guardiaoOffline), `src/lib/p2p/`.
- **Letras**: `src/lib/lyrics/lyrics.ts` + `components/media/LyricsView.tsx`.
- **Dados**: Postgres via Prisma (api), Firestore/Firebase (web), IndexedDB + Cache Storage (offline).

## Deploy existente

- **Vercel** (`vercel.json`): framework vite, build filtrado shared+web, output `apps/web/dist`,
  rewrites `/api/*` → `aurial-api.nexusholding.xyz`, `/importer/*` → `importer.nexusholding.xyz`,
  SPA fallback, cache imutável em `/assets`, headers de segurança.
  ⚠️ memória: rewrite da Vercel toma 403 do Cloudflare — navegador deve falar direto com o servidor.
- API/importer em servidor próprio (nginx + systemd/pm2, `infra/`).

## Estado da árvore (sujo, não commitado)

`detalheDaFaixa.ts`, `playbackDiagnosis.ts` (+117), `lyrics.ts`, `playerStore.ts` (+79),
e novo teste `stores/__tests__/urlCongeladaDaCurtida.test.ts`.

## Impacto do pedido

Otimizar e zerar bugs de execução de música toca, em ordem de probabilidade:

1. `apps/web/src/stores/playerStore.ts` — núcleo da fila/estado; arquivo grande, já em edição.
2. `apps/web/src/lib/audio/AudioEngine.ts` + `mediaSession.ts` — play/pause, seek, crossfade,
   áudio em segundo plano (`<audio>` direto, sem Web Audio — ver memória).
3. `apps/web/src/lib/local/{playbackDiagnosis,validateAudio,reparador,faixasQueFalharam}.ts` —
   diagnóstico de faixa que não toca.
4. `apps/web/src/lib/offline/{audioCache,guardiaoOffline}.ts` — tocar sem rede, quota, alças de blob.
5. `apps/web/src/lib/catalog/` e `apiBase.ts` — resolução de `streamUrl`, 403/404, cofre podado.
6. UI: `PlayerBar`, `MiniPlayer`, `NowPlaying`, `QueuePanel`, `SeekSlider`, `WaveformSeeker`.
7. Testes: `apps/web/src/**/__tests__` (vitest) e `apps/web/e2e` (playwright) para reproduzir antes de prometer.
