<div align="center">

<!-- logo: substitua por docs/assets/logo.svg quando disponível -->

# 🎧 Aurial

**Streaming de música profissional — minimal, glass, elegante, rápido.**

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
[![Deploy Web](https://github.com/OWNER/REPO/actions/workflows/deploy-web.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/deploy-web.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)
![License](https://img.shields.io/badge/license-proprietary-red)

<!-- badges: troque OWNER/REPO pela org/repo reais no GitHub -->

<!-- screenshot: substitua por docs/assets/screenshot-home.png -->
<img src="https://placehold.co/1200x680/0A0A0C/17E68C?text=Aurial+%E2%80%94+screenshot+em+breve" alt="Aurial — screenshot" width="800" />

</div>

---

## O que é o Aurial

O **Aurial** (aura + aural) é uma plataforma de streaming de música completa e auto-hospedável: você envia seus arquivos de áudio, um pipeline FFmpeg transcodifica tudo para **HLS adaptativo**, e um player de nível profissional entrega a experiência — crossfade, gapless, equalizador e ReplayGain — em uma interface _deep black + glass_ com um único verde exclusivo.

Web na edge (Vercel) + API em servidor próprio (Docker) = custo mínimo, controle total do áudio.

## Features

- 🎚️ **Player pro**: crossfade e reprodução **gapless** (dual Howl + Web Audio), **EQ de 10 bandas**, **ReplayGain** (normalização para −14 LUFS), velocidade 0.5×–2×, visualizador de espectro, letras sincronizadas
- ⬆️ **Uploads com pipeline FFmpeg**: ffprobe + validação por magic bytes → análise de loudness (LUFS/true peak) → ladder HLS AAC 96/160/320 kbps → waveform (1024 picos) → capas WebP em 3 tamanhos — tudo em fila durável (BullMQ + Redis)
- 📡 **HLS adaptativo** com URLs assinadas (HMAC, curta duração) e cache de segmentos no nginx
- 📱 **PWA offline**: instalável, shell offline, cache de capas, Media Session API (controles do SO), atalhos de teclado
- 👥 **Social**: seguir usuários/artistas, feed de atividade, comentários em faixas, **listen-together** em tempo real (socket.io)
- 🔎 Busca instantânea com autocomplete, home personalizada, recomendações (daily mix, discover, moods, track radio)
- 📚 Biblioteca completa: playlists colaborativas com reordenação, curtidas, histórico ("continue ouvindo"), podcasts e rádios
- 🛡️ **Admin**: métricas, moderação de usuários/uploads, fila de jobs, audit log
- 🔐 Auth via **Firebase** (Google/Apple/GitHub/email/anônimo) — nenhuma senha armazenada na API

## Stack

| Camada   | Tecnologia                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Web      | React 19 · Vite · TypeScript · Tailwind · TanStack Query · Zustand · Framer Motion · Howler/Web Audio · vite-plugin-pwa |
| API      | Node 22 · Express 5 · Prisma · Zod · socket.io · BullMQ · pino · OpenAPI 3.1 (Swagger em `/api/docs`)                   |
| Dados    | PostgreSQL 16 · Redis 7                                                                                                 |
| Áudio    | FFmpeg (HLS AAC 96/160/320, loudnorm, waveform) · sharp (capas WebP)                                                    |
| Auth     | Firebase Auth (web SDK + firebase-admin)                                                                                |
| Storage  | Cloudflare R2 (S3) · Supabase Storage · disco local (dev) — via interface `StorageProvider`                             |
| Infra    | Docker Compose · nginx · PM2 (alternativa bare-metal) · GitHub Actions · Vercel                                         |
| Contrato | `@aurial/shared` — schemas Zod + DTOs compartilhados entre web e api                                                    |

## Arquitetura

```mermaid
flowchart LR
  subgraph Edge
    W["apps/web · SPA React<br/>(Vercel)"]
  end
  subgraph Servidor["Servidor Linux (Docker Compose)"]
    N["nginx :80/:443<br/>rate limit · cache HLS"]
    A["api :4000<br/>Express 5 · socket.io /ws"]
    K["worker<br/>BullMQ · FFmpeg"]
    P[("PostgreSQL 16")]
    R[("Redis 7")]
  end
  S[("Storage<br/>R2 / S3 / Supabase")]
  F["Firebase Auth"]

  W -- "REST /api/v1 · WS /ws" --> N
  N --> A
  A --> P
  A --> R
  K --> P
  R <--> K
  A --> S
  K --> S
  W -.tokens.-> F
  A -.verifica ID token.-> F
```

Decisões e regras completas em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · design system em [`docs/DESIGN.md`](docs/DESIGN.md).

## Estrutura de pastas

```
aurial/
├── apps/
│   ├── web/          # SPA React 19 + Vite (Vercel)
│   └── api/          # Node 22 + Express 5 + Prisma (Docker/PM2 no servidor)
├── packages/
│   └── shared/       # @aurial/shared — schemas Zod, DTOs, constantes
├── infra/
│   ├── docker/       # docker-compose.dev.yml (deps locais) · docker-compose.prod.yml (stack completa)
│   ├── nginx/        # reverse proxy de produção (rate limit, WS, cache HLS, TLS)
│   ├── pm2/          # ecosystem.config.cjs (deploy bare-metal alternativo)
│   └── scripts/      # setup-server.sh · deploy-api.sh · backup-db.sh · *.ps1 (Windows)
├── docs/             # ARCHITECTURE · DESIGN · DEPLOY · CONTRIBUTING
└── .github/          # CI + deploys (Actions), templates de PR/issue
```

## Começando

### Pré-requisitos

- **Node.js 22** (`.nvmrc`) e **pnpm 10** (`corepack enable` resolve)
- **Docker** (para Postgres + Redis locais) — _ou_ PostgreSQL 16 e Redis 7 nativos
- **FFmpeg** no PATH (pipeline de áudio; `winget install ffmpeg` / `brew install ffmpeg`)
- Um projeto **Firebase** (gratuito) para autenticação

### Passo a passo

```bash
# 1. Dependências
pnpm install

# 2. Postgres + Redis locais (projeto docker: aurial-dev)
docker compose -f infra/docker/docker-compose.dev.yml up -d

# 3. Variáveis de ambiente (edite com suas credenciais Firebase)
cp .env.example apps/api/.env         # bloco "API"
cp .env.example apps/web/.env.local   # bloco "WEB" (VITE_*)

# 4. Banco: migrations + seed
pnpm db:migrate
pnpm db:seed

# 5. Sobe web + api em paralelo
pnpm dev
```

| Serviço           | URL local                                          |
| ----------------- | -------------------------------------------------- |
| Web (SPA)         | http://localhost:5173                              |
| API               | http://localhost:4000                              |
| Swagger (OpenAPI) | http://localhost:4000/api/docs                     |
| Healthcheck       | http://localhost:4000/healthz                      |
| PostgreSQL        | `postgresql://aurial:aurial@localhost:5432/aurial` |
| Redis             | `redis://localhost:6379`                           |

> Sem Docker? Suba Postgres/Redis nativos com o mesmo usuário/senha/banco (`aurial`/`aurial`/`aurial`) e os mesmos ports — o `.env.example` já aponta para eles.

## Scripts

| Comando                                       | Ação                               |
| --------------------------------------------- | ---------------------------------- |
| `pnpm dev`                                    | web + api em modo dev (paralelo)   |
| `pnpm dev:web` / `pnpm dev:api`               | apenas um dos apps                 |
| `pnpm build`                                  | build de todos os pacotes          |
| `pnpm lint` / `pnpm lint:fix`                 | ESLint                             |
| `pnpm format` / `pnpm format:check`           | Prettier                           |
| `pnpm typecheck`                              | `tsc --noEmit` em todos os pacotes |
| `pnpm test` / `pnpm test:coverage`            | Vitest em todos os pacotes         |
| `pnpm e2e`                                    | Playwright (web)                   |
| `pnpm db:generate` / `db:migrate` / `db:seed` | Prisma                             |

## Testes

- **Unitários** (Vitest): services da API com repositórios mockados, componentes web com Testing Library, schemas do shared — `pnpm test`
- **E2E** (Playwright): smoke da SPA (carrega, navega, player monta) — `pnpm e2e`
- **CI**: todo push/PR para `main` roda install → build shared → prisma generate → lint → typecheck → test → build ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))

## Deploy

Resumo (guia completo em [`docs/DEPLOY.md`](docs/DEPLOY.md)):

- **Web** → Vercel (root directory `apps/web`, config em [`apps/web/vercel.json`](apps/web/vercel.json)); deploy automático via [`deploy-web.yml`](.github/workflows/deploy-web.yml)
- **API** → servidor Linux na LAN via Docker Compose ([`infra/docker/docker-compose.prod.yml`](infra/docker/docker-compose.prod.yml)): postgres + redis + api + worker + nginx; bootstrap com `infra/scripts/setup-server.sh`, deploy com `infra/scripts/deploy-api.sh` (ou `deploy-from-windows.ps1` da máquina dev)
- Alternativa bare-metal com **PM2**: [`infra/pm2/ecosystem.config.cjs`](infra/pm2/ecosystem.config.cjs)

## Roadmap

- [ ] **Premium**: assinaturas (qualidade lossless, downloads ilimitados)
- [ ] **Sync multi-device**: continuar a reprodução em outro aparelho (handoff)
- [ ] **Recomendações com ML**: embeddings de áudio para similaridade real (hoje: heurísticas por gênero/histórico)
- [ ] Scrobbling (Last.fm), apps desktop (Tauri), salas públicas de listen-together

## Licença

**Proprietária** — todos os direitos reservados. Uso, cópia ou distribuição apenas com autorização expressa. Este repositório não aceita contribuições externas sem convite (veja [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)).
