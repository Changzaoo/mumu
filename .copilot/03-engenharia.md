# 03 — Engenharia

Projeto **brownfield** em produção (aurial.vercel.app). A decisão de stack aqui é
**manter o que já roda** e só mexer no que o pedido exige (execução de música).
Trocar stack seria risco puro sem ganho para RF1–RF7.

## Stack (versão e motivo)

| Camada              | Escolha                                                 | Versão                 | Motivo                                                                                                                                      |
| ------------------- | ------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime/gerenciador | Node + pnpm workspaces                                  | Node >=20, pnpm 10.4.1 | Já é o monorepo; maduro e travado por `packageManager`.                                                                                     |
| Web                 | React + Vite + TypeScript                               | 19 / 6 / 5.7           | Padrão atual do ecossistema; `pnpm build` já é o portão.                                                                                    |
| Estado              | Zustand + TanStack Query                                | 5 / 5.102              | `playerStore` (fila/player) já é Zustand; Query cuida do servidor.                                                                          |
| UI                  | Tailwind v4 + Radix + framer-motion                     | 4.0 / — / 12           | Instalado e em uso; nada a decidir.                                                                                                         |
| **Áudio**           | `HTMLAudioElement` via **howler 2.2.4** (`html5: true`) | 2.2.4                  | Já em `AudioEngine.ts:648`; `html5:true` = elemento `<audio>` real, compatível com a regra de áudio de fundo. Não trocar de motor (fase 1). |
| HLS                 | `hls.js` **type-only**                                  | 1.5.20                 | Só `import type` hoje; se virar runtime, tem que ser `import()` dinâmico.                                                                   |
| Waveform            | **remover `wavesurfer.js`**                             | 7.9 → —                | Zero imports em `apps/web/src`: dependência morta (RNF4).                                                                                   |
| API                 | Express 5 + Prisma 6 + BullMQ                           | 5.2 / 6.2 / 5.34       | Em produção; fora do escopo salvo bug de resolução de URL (RNF7).                                                                           |
| Dados               | Postgres (Prisma) + Firestore + IndexedDB/Cache Storage | —                      | Já é o desenho: acervo saiu do Firestore por custo (ver `app.ts:99-105`).                                                                   |
| Testes              | Vitest 3 + Playwright 1.50                              | —                      | Portões RNF1/RNF2. `pnpm lint` **não** é portão (quebrado de base).                                                                         |

## Arquitetura

Um único dono do áudio, três anéis ao redor:

```
UI (PlayerBar/MiniPlayer/NowPlaying/QueuePanel)
        │ ações                    ▲ estado derivado
        ▼                          │
playerStore (Zustand) ── fila, repeat, shuffle, watchdog, INTENÇÃO
        │ comandos (play/pause/seek/load)   ▲ eventos
        ▼                                   │
AudioEngine ── 2 slots (ativo/pré-carga), cada slot = 1 <audio>
        ├── caminho principal: <audio> direto  (sempre válido, tela apagada)
        └── enfeite opcional: Web Audio (EQ/espectro) — só com página visível
resolução de fonte: local (IndexedDB/Cache) → catálogo/API → P2P
```

Regras de fronteira (viram teste, não comentário):

- **Token de geração**: todo `load/play` carrega um `seq`; evento de slot com `seq`
  velho é ignorado e `AbortError` de `play()` é engolido (RF1).
- **Intenção vs. realidade**: o store guarda o que o usuário quis; ao fim de cada
  transição reconcilia (se a intenção é tocar e está parado, toca).
- **Web Audio é opcional**: `createMediaElementSource` só quando visível; ao esconder
  a página o grafo é desconectado e o som continua no `<audio>` (RF5, memória do projeto).
- **Um slot manda no foco de áudio** por vez; nada de dois contextos (RNF5).
- **SW não cacheia áudio** enquanto não houver suporte a Range/206 (restrição da fase 2).
- **Alças de blob** têm dono: revogadas em troca de faixa, `ended` e unmount (RNF3).

## Dados

| Onde                   | O quê                                                             | Forma               |
| ---------------------- | ----------------------------------------------------------------- | ------------------- |
| Postgres (Prisma, api) | acervo, usuários, coleções, histórico, imports                    | tabelas relacionais |
| Firestore              | dados por usuário legados + regras em `firestore.rules`           | doc/coleção         |
| IndexedDB (web)        | faixas baixadas, metadados, **duração conhecida**, fila de import | store por faixa     |
| Cache Storage          | bytes de áudio baixado (`caches.open` em `localLibrary`)          | resposta completa   |
| localStorage           | preferências do player (volume, repeat, shuffle)                  | chave/valor         |

Campo que o pedido obriga a tratar: **`durationMs` persistido** junto da faixa
(IndexedDB/catálogo). É a fonte primária da duração; `seekable` e `loadedmetadata`
viram fallback, e nada não-finito chega ao `setPositionState` (RF2).

Validação: schemas **zod 3** em `packages/shared` — mesmo schema no cliente e na API.

## Segurança (checklist)

| Item                                   | Status               | Justificativa (1 linha)                                                                  |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| AuthN/AuthZ por recurso                | **aplicado**         | `authenticate` em todo `/api/v1` (`app.ts:77`) + `firestore.rules` por `uid`/admin.      |
| Validação/sanitização por schema       | **aplicado**         | zod compartilhado; `express.json({limit:'1mb'})`.                                        |
| Injeção (SQL/NoSQL/cmd/XSS)            | **aplicado**         | Prisma parametriza; React escapa; nada de `dangerouslySetInnerHTML` no player.           |
| CSRF                                   | **não se aplica**    | API sem cookie de sessão: token Bearer + CORS por allowlist.                             |
| Cabeçalhos (CSP/HSTS/nosniff/Referrer) | **parcial → tarefa** | `helmet` na API; `vercel.json` tem nosniff/Referrer/X-Frame mas **sem CSP nem HSTS**.    |
| CORS restrito                          | **aplicado**         | allowlist `webOrigins` (`app.ts:49-57`).                                                 |
| Rate limiting                          | **aplicado**         | `globalRateLimit` + `rate-limit-redis`.                                                  |
| Segredos fora do código / rotação      | **parcial**          | `.env` no git-ignore e `.env.example`; rotação pendente (memória `aurial-deploy-state`). |
| Dependências fixadas e auditadas       | **parcial → risco**  | lockfile congelado no deploy; `pnpm audit --prod` = **10 vulns (6 high, 4 moderate)**.   |
| Logs sem dados sensíveis               | **aplicado**         | `pino`/`pino-http` com `requestId`; sem token no log.                                    |
| Upload limitado                        | **aplicado**         | `multer` `{fileSize: MAX_UPLOAD_SIZE_BYTES, files:1}` + `file-type`.                     |
| Erro sem stack ao usuário              | **aplicado**         | `errorHandler` central com envelope.                                                     |
| HTTPS                                  | **aplicado**         | Vercel + nginx/Cloudflare com TLS; nada em http.                                         |
| Menor privilégio no deploy             | **aplicado**         | systemd de usuário no servidor; `trust proxy 1` atrás do nginx.                          |
| Backups                                | **parcial**          | `genero_backup_manual` no Postgres é pontual; sem rotina automática — risco registrado.  |

Vulnerabilidades do `pnpm audit --prod` (saída real): `music-metadata` (loop infinito),
`sharp`/libvips, `socket.io` (exaustão de memória), `react-router` (CSRF em modo RSC —
**não usamos RSC**), `fast-xml-parser`, `DeepmergeTS`, `file-type`, `uuid`, `qs` (x2).
Nenhuma está no caminho de reprodução de música; **não serão corrigidas nesta entrega**
para não misturar bump de dependência com correção de player — vão para Riscos.

## Deploy

| Parte          | Destino                                            | Como                                                                                                    |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Frontend       | **Vercel** (aurial.vercel.app)                     | `vercel.json`: build filtrado `shared`+`web`, output `apps/web/dist`, SPA fallback, `/assets` imutável. |
| API            | **servidor próprio** `aurial-api.nexusholding.xyz` | nginx + systemd/pm2 (`infra/`).                                                                         |
| Importer       | **servidor próprio** `importer.nexusholding.xyz`   | binários yt-dlp/ffmpeg, systemd de usuário, cofre em disco externo.                                     |
| Postgres/Redis | mesmo servidor (docker em `infra/`)                | migrações via `pnpm db:migrate`.                                                                        |
| Android        | Capacitor 8 embrulhando a web                      | fora do escopo verificável desta entrega.                                                               |

⚠️ **Rewrite da Vercel toma 403 do Cloudflare** (memória): chamada de áudio/API que
importa para reprodução deve ir **direto** do navegador ao servidor, não pelo rewrite.
Deploy = push na `main` (Vercel automático); API por script em `infra/`.

## Riscos

1. **iOS e Android 17/FGS** — sem aparelho para reproduzir; registrado, não prometido (RNF6).
2. **10 vulnerabilidades de dependência** (6 high) fora do caminho de áudio; bump fica
   para entrega própria, senão contamina o diff do player.
3. **Sem CSP/HSTS na Vercel** — CSP em app com áudio de terceiros/blob quebra fácil;
   entra só com `Content-Security-Policy-Report-Only` antes de virar bloqueante.
4. **Sem rotina de backup** do Postgres; hoje só backup manual pontual.
5. **`pnpm lint` quebrado de base** (~7767) — bug de qualidade real passa despercebido.
6. **Cofre menor que o acervo** (poda é regime normal): 403/404 de `streamUrl` é
   estado esperado, tem que falhar visível e pulável (RF7), não virar spinner eterno.
7. **Dois caminhos de slot** (howler vs `prepareElementSlot` para HLS) dobram a
   superfície de bug de transição; o token de geração precisa cobrir os dois.

STATUS: OK
