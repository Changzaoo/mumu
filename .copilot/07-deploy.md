# 07 — Deploy (fase 8)

Portão da fase 7 conferido antes de mexer em qualquer coisa: **verde**
(200 + 217 + 689 unidade/integração, 6 e2e, `pnpm build` código 0).

## Mapa: onde cada parte vive

| Parte             | Onde                                                      | Como sobe                                         |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------- |
| Frontend (SPA)    | **Vercel**, projeto `aurial` (`changzaoos-projects`)      | push na `main` → build automático (`vercel.json`) |
| API Express       | **servidor próprio** `vnmax` (192.168.0.100), docker      | `infra/scripts/deploy-api.sh` por SSH             |
| Worker (BullMQ)   | mesmo compose, `aurial-worker-1`                          | junto com a API                                   |
| Postgres / Redis  | mesmo compose, `aurial-postgres-1` / `aurial-redis-1`     | `prisma migrate deploy` dentro do script          |
| Importer (yt-dlp) | mesmo servidor, **systemd de usuário** `radinho-importer` | fora deste script (serviço próprio)               |
| Exposição pública | Cloudflare Tunnel (`radinho-api-tunnel`, `…-importer-…`)  | systemd de usuário                                |
| Estáticos do app  | `apps/web/dist` na Vercel, `/assets` imutável 1 ano       | `vercel.json`                                     |
| Bytes de áudio    | cofre em disco no servidor + IndexedDB/Cache no navegador | não passa por deploy                              |

Configurações que já existiam: `vercel.json`, `apps/api/Dockerfile`, três
`infra/docker/docker-compose*.yml`, `infra/nginx/`, `infra/pm2/`,
`infra/systemd/`, e os workflows `ci.yml`, `deploy-web.yml`, `deploy-api.yml`.

## Status do deploy — EXECUTADO

**Frontend — no ar.** Deploy de produção `dpl_AB8U4YxkaRxTAuY7GgPNCy2BpypG`,
● Ready, com os aliases:

- **https://aurial.vercel.app** → `200`
- **https://radinho.online** (mesmo deploy)
- `/search` (rota de SPA) → `200`, fallback funcionando.

**API — a fase 7 NÃO estava no ar; agora está.** Este foi o achado da fase: o
servidor rodava `c5b4321` (31/08), **30 commits atrás**, `uptime` de 3,7 dias.
As duas correções de segurança da fase 7 — faixa escondida vazando com
`streamUrl` assinado, e origem hostil virando `500` com pilha no log — estavam
apenas no repositório. Prova antes de mexer:

```
curl -H "Origin: https://evil.example.com" .../api/v1/tracks
{"error":{"code":"INTERNAL","message":"Internal server error"}} [500]   ← bug vivo
```

`./infra/scripts/deploy-api.sh` rodado por SSH (chave já autorizada; o caminho
real é `/opt/aurial`, não `/opt/radinho` como dizia o `.env.example` — corrigido).
Saída real: `6 migrations found / No pending migrations to apply` →
`aurial-api-1` e `aurial-worker-1` recriados → `API healthy after 5 attempt(s)`
→ `Deploy complete.` Verificação depois, em produção:

```
git rev-parse HEAD (servidor) → 95c9d86      ← igual ao HEAD local
/healthz                      → 200 {"status":"ok"}
Origin hostil                 → 403 {"code":"FORBIDDEN"}   ← corrigido no ar
/api/v1/me sem token          → 401                        ← authenticate ativo
/api/v1/search?q=a            → 200                        ← busca pública viva
```

Antes do build foi preciso liberar disco no servidor (89% cheio, 2,8 GB livres):
`docker builder prune -f` recuperou 2,4 GB → 80%. Sem isso o build de imagem
com ffmpeg não caberia.

## Segredos e variáveis

Nenhum segredo versionado: `git grep` por chave privada, `AIza…`, `sk-…`,
`ghp_…`, `xox…`, `AKIA…` em arquivos rastreados não achou nada; os dois `.env`
reais (`apps/api/.env`, `apps/web/.env.production.local`) estão cobertos pelo
`.gitignore` (linhas 15 e 17). Só `.env.example` é rastreado.

Auditoria de completude (comparando o que o código lê com o que o exemplo
documenta) achou **13 variáveis usadas e não documentadas**, agora escritas:

- API: `IMPORTER_URL`, `IMPORTER_PUBLIC_URL`, `IMPORT_SERVICE_TOKEN`,
  `VARREDURA_HORA_INICIO/FIM`, `VARREDURA_MAX_POR_NOITE`,
  `VARREDURA_FOLGA_MINIMA_BYTES`, `CLASSIFICAR_CONTEUDO`, `ACERVO_FIEL_INTERVAL_MS`.
- Web: `VITE_SIGNALING_URL`, `VITE_TURN_URL/USER/PASS` (P2P).

⚠ Registrado no próprio `.env.example`: **tudo que começa com `VITE_` vai para o
bundle e é público**. `VITE_TURN_PASS` não pode ser credencial de TURN de longa
duração — tem que ser efêmera (TURN REST), senão está publicada.

## Checklist pós-deploy

1. `/api/v1/*` continua sendo chamado **direto** pelo navegador; o rewrite da
   Vercel toma `403` do Cloudflare (confirmado de novo hoje: `/api/…` pelo
   domínio da Vercel → `403`). Não mover chamada de áudio para o rewrite.
2. Rotação de segredos segue **pendente** (Firebase/`STREAM_TOKEN_SECRET`).
3. Disco do servidor em **80%** depois da limpeza — `docker builder prune`
   antes do próximo deploy, senão o build de imagem não cabe.
4. Sem CSP/HSTS na Vercel (risco 3 da fase 3) e sem rotina de backup (risco 4).
5. `deploy-api.yml` não roda em runner da GitHub: o servidor é LAN. Deploy da
   API é manual por SSH — o que foi feito aqui.
6. Android/Capacitor: não verificável nesta entrega.

STATUS: OK
