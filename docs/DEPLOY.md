# Aurial — Guia de Deploy

> Passo a passo completo: servidor LAN (API via Docker Compose) + Vercel (web).
> Topologia, arquivos e serviços referenciados aqui vivem em `infra/` e `.github/workflows/`.

## Sumário

1. [Topologia](#1-topologia)
2. [Preparar o servidor (setup-server.sh)](#2-preparar-o-servidor)
3. [Chaves SSH (setup-ssh-key.ps1)](#3-chaves-ssh)
4. [.env de produção](#4-env-de-produção)
5. [Primeira subida da API](#5-primeira-subida-da-api)
6. [Vercel (web)](#6-vercel-web)
7. [GitHub Actions — secrets](#7-github-actions--secrets)
8. [DNS + TLS (exposição pública)](#8-dns--tls-exposição-pública)
9. [Backups](#9-backups)
10. [Monitoramento](#10-monitoramento)
11. [Alternativa bare-metal (PM2)](#11-alternativa-bare-metal-pm2)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Topologia

```
Internet ──> Vercel (apps/web — SPA estática)
                 │  REST /api/v1 · WebSocket /ws
                 ▼
LAN 192.168.0.0/24 ──> servidor Ubuntu 192.168.0.100 (/opt/aurial)
    docker compose (projeto "aurial"):
      nginx :80/:443 ── proxy, rate limit, cache HLS (volume media-cache)
      api   :4000    ── Express 5 + socket.io (imagem aurial-api)
      worker         ── BullMQ + FFmpeg (mesma imagem)
      postgres :5432 ── só na rede interna do docker
      redis    :6379 ── só na rede interna do docker
      migrate        ── one-shot (profile "tools"): prisma migrate deploy
```

- Valores padrão (de `.env.example`): `DEPLOY_HOST=192.168.0.100`, `DEPLOY_USER=v`, `DEPLOY_PATH=/opt/aurial`.
- A porta **4000** é publicada para acesso direto na LAN (o ufw a restringe à subnet); **80/443** são o caminho via nginx.

## 2. Preparar o servidor

O script é **idempotente** — pode rodar de novo sem medo. Instala Docker + compose plugin, git, ffmpeg e ufw; habilita o firewall (22/80/443 + 4000 apenas LAN); cria `/opt/aurial`.

Da máquina Windows (antes mesmo de o repo existir no servidor):

```powershell
scp infra/scripts/setup-server.sh v@192.168.0.100:/tmp/
ssh -t v@192.168.0.100 "sudo bash /tmp/setup-server.sh"
```

> O usuário `v` entra no grupo `docker` — é preciso **relogar** (sair e entrar no SSH) para valer.

Depois, clone o repo no servidor:

```bash
ssh v@192.168.0.100
git clone <URL-do-repo> /opt/aurial
chmod +x /opt/aurial/infra/scripts/*.sh
```

> Sem acesso git no servidor? Use rsync a partir da máquina dev (comentário no topo de `deploy-api.sh` mostra o comando).

## 3. Chaves SSH

Senha só serve para o bootstrap. Migre para chave **antes** de configurar CI:

```powershell
# na máquina Windows, na raiz do repo
.\infra\scripts\setup-ssh-key.ps1
```

O script: gera `~/.ssh/id_ed25519` (se faltar) → instala a chave pública no servidor (pede a senha **uma** vez, nunca a armazena) → testa o login por chave → imprime como desabilitar senha (`/etc/ssh/sshd_config` → `PasswordAuthentication no` → `sudo systemctl restart ssh`). Só desabilite a senha **depois** que o teste por chave passar.

Para o CI, gere uma **chave dedicada** (não reutilize a sua):

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\aurial-ci -C "aurial-ci"
Get-Content $env:USERPROFILE\.ssh\aurial-ci.pub | ssh v@192.168.0.100 "cat >> ~/.ssh/authorized_keys"
# o conteúdo de ~\.ssh\aurial-ci (a PRIVADA) vira o secret SSH_KEY (seção 7)
```

## 4. .env de produção

O compose lê `env_file: /opt/aurial/.env` (a partir de `.env.example`):

```bash
cd /opt/aurial
cp .env.example .env
nano .env
```

Diferenças obrigatórias em relação ao dev (hosts passam a ser os **nomes dos serviços** do compose):

| Variável                               | Valor de produção                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                             | `production`                                                                            |
| `DATABASE_URL`                         | `postgresql://aurial:aurial@postgres:5432/aurial?schema=public`                         |
| `REDIS_URL`                            | `redis://redis:6379`                                                                    |
| `API_BASE_URL`                         | `http://192.168.0.100:4000` (ou `https://api.seudominio.com` após a seção 8)            |
| `WEB_ORIGIN`                           | a URL do site na Vercel (ex.: `https://aurial.vercel.app`) — CORS depende disso         |
| `STREAM_TOKEN_SECRET`                  | gere: `openssl rand -hex 32`                                                            |
| `FIREBASE_*`                           | credenciais do service account (Project Settings → Service Accounts)                    |
| `STORAGE_DRIVER` + `R2_*`/`SUPABASE_*` | `r2` recomendado em produção (`local` exige volume persistente — comentário no compose) |
| `LOG_LEVEL`                            | `info`                                                                                  |

> Postgres/Redis **não** são publicados fora da rede do docker. Se um dia expor o Postgres, troque a senha em `docker-compose.prod.yml` **e** na `DATABASE_URL`.

## 5. Primeira subida da API

```bash
cd /opt/aurial
./infra/scripts/deploy-api.sh
```

O script executa, nesta ordem: `git pull --ff-only` → `docker compose build api worker` → migrations (`--profile tools run --rm migrate`, que roda `prisma migrate deploy`) → `up -d` → loop de healthcheck em `http://localhost:4000/healthz` (com instruções de rollback se falhar) → prune de imagens antigas.

Seed inicial (opcional, uma vez):

```bash
docker compose -f infra/docker/docker-compose.prod.yml --profile tools run --rm migrate npx prisma db seed
```

Verificações:

```bash
docker compose -f infra/docker/docker-compose.prod.yml ps      # tudo "healthy"
curl http://localhost:4000/healthz                             # direto na API
curl http://localhost/healthz                                  # através do nginx
```

Deploys seguintes: rode o mesmo script — ou, da máquina Windows, `.\infra\scripts\deploy-from-windows.ps1` — ou deixe o workflow `deploy-api.yml` cuidar disso (seção 7).

## 6. Vercel (web)

1. **Import** do repositório em [vercel.com/new](https://vercel.com/new).
2. Configurações do projeto (o `apps/web/vercel.json` já encode os comandos; confirme no dashboard):

| Configuração     | Valor                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| Root Directory   | `apps/web`                                                              |
| Framework Preset | Vite                                                                    |
| Install Command  | `corepack enable && pnpm install --frozen-lockfile`                     |
| Build Command    | `pnpm --filter @aurial/shared build && pnpm --filter @aurial/web build` |
| Output Directory | `dist`                                                                  |
| Node.js Version  | 22.x                                                                    |

3. Environment Variables (Production) — nomes exatamente como no `.env.example`:

| Variável                                                                                                                                                                           | Valor                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`                                                                                                                                                                     | `https://api.seudominio.com/api/v1` (ou `http://192.168.0.100:4000/api/v1` só para testes na LAN) |
| `VITE_WS_URL`                                                                                                                                                                      | `https://api.seudominio.com` (mesma origem da API; socket.io usa path `/ws`)                      |
| `VITE_FIREBASE_API_KEY` · `VITE_FIREBASE_AUTH_DOMAIN` · `VITE_FIREBASE_PROJECT_ID` · `VITE_FIREBASE_STORAGE_BUCKET` · `VITE_FIREBASE_MESSAGING_SENDER_ID` · `VITE_FIREBASE_APP_ID` | Firebase Console → Project Settings → General → Your apps                                         |

> ⚠️ **Mixed content**: o site na Vercel é `https://` — navegadores **bloqueiam** chamadas a `http://192.168.0.100:4000`. Para o site público funcionar de verdade, a API precisa de HTTPS (seção 8) ou de uma rota privada (Tailscale + HTTPS). Para uso apenas na LAN, rode o web localmente (`pnpm dev:web`) apontando para o servidor.

4. Deploy automático: o workflow `deploy-web.yml` usa o fluxo `vercel pull → vercel build --prod → vercel deploy --prebuilt --prod`. Para obter `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`, rode `vercel link` uma vez localmente e copie de `.vercel/project.json`. Desative o auto-deploy nativo da Vercel (Settings → Git) se quiser que **só** o Actions publique.

## 7. GitHub Actions — secrets

`Settings → Secrets and variables → Actions → New repository secret`:

| Secret              | Usado por        | Valor                                                                   |
| ------------------- | ---------------- | ----------------------------------------------------------------------- |
| `VERCEL_TOKEN`      | `deploy-web.yml` | token em [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID`     | `deploy-web.yml` | `.vercel/project.json` (`orgId`) após `vercel link`                     |
| `VERCEL_PROJECT_ID` | `deploy-web.yml` | `.vercel/project.json` (`projectId`)                                    |
| `SSH_HOST`          | `deploy-api.yml` | `192.168.0.100` (ou hostname Tailscale)                                 |
| `SSH_USER`          | `deploy-api.yml` | `v`                                                                     |
| `SSH_KEY`           | `deploy-api.yml` | conteúdo da chave **privada** dedicada de CI (seção 3)                  |

> ⚠️ **Alcançabilidade**: runners hospedados no GitHub **não enxergam** `192.168.0.100`. Opções (detalhadas no cabeçalho de `deploy-api.yml`): **(a)** runner self-hosted na LAN (troque `runs-on` para `[self-hosted, aurial]`) — recomendado; **(b)** Tailscale/WireGuard + `SSH_HOST` apontando para o endereço da tailnet; **(c)** deploy manual com `deploy-from-windows.ps1`.

## 8. DNS + TLS (exposição pública)

Quando quiser expor a API na internet:

1. **DNS**: registro `A` de `api.seudominio.com` → seu IP público; port forward 80/443 do roteador → `192.168.0.100` (ou DDNS se IP dinâmico).
2. **Certificado** (certbot standalone; pare o nginx por 1 min para liberar a porta 80):

```bash
sudo apt-get install -y certbot
cd /opt/aurial
docker compose -f infra/docker/docker-compose.prod.yml stop nginx
sudo certbot certonly --standalone -d api.seudominio.com
sudo cp /etc/letsencrypt/live/api.seudominio.com/fullchain.pem infra/nginx/certs/
sudo cp /etc/letsencrypt/live/api.seudominio.com/privkey.pem  infra/nginx/certs/
sudo chown v:v infra/nginx/certs/*.pem
```

3. **nginx**: em `infra/nginx/nginx.conf`, descomente o bloco `server { listen 443 ssl; ... }` do final do arquivo (copiando os `location` do server de :80, como indicado nos comentários) e ative o redirect 80→443. Depois: `docker compose -f infra/docker/docker-compose.prod.yml up -d nginx`.
4. **Renovação** (certificados Let's Encrypt duram 90 dias) — cron mensal:

```
0 4 1 * * certbot renew --pre-hook "docker compose -f /opt/aurial/infra/docker/docker-compose.prod.yml stop nginx" --post-hook "cp /etc/letsencrypt/live/api.seudominio.com/*.pem /opt/aurial/infra/nginx/certs/ && docker compose -f /opt/aurial/infra/docker/docker-compose.prod.yml start nginx"
```

5. Atualize `API_BASE_URL`/`WEB_ORIGIN` no `.env` do servidor e `VITE_API_URL`/`VITE_WS_URL` na Vercel.

## 9. Backups

`infra/scripts/backup-db.sh` faz `pg_dump` (gzip) do container postgres para `/opt/aurial/backups`, valida o tamanho e mantém os **14** mais recentes.

```bash
# manual
/opt/aurial/infra/scripts/backup-db.sh

# cron diário às 03:00 (crontab -e como usuário v)
0 3 * * * /opt/aurial/infra/scripts/backup-db.sh >> /opt/aurial/backups/backup.log 2>&1
```

Restore (instruções também no cabeçalho do script):

```bash
gunzip -c /opt/aurial/backups/aurial-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f /opt/aurial/infra/docker/docker-compose.prod.yml exec -T postgres psql -U aurial -d aurial
```

> Backups ficam no mesmo disco do banco — copie periodicamente para fora (rsync para a máquina dev, R2, etc.). Mídia em R2/Supabase já está fora do servidor; se `STORAGE_DRIVER=local`, inclua o volume de storage na rotina.

## 10. Monitoramento

- **Containers**: `docker compose -f infra/docker/docker-compose.prod.yml ps` (coluna health) e `docker stats` (CPU/mem vs. limites definidos no compose).
- **Logs** (pino, JSON estruturado):

```bash
docker compose -f infra/docker/docker-compose.prod.yml logs -f --tail 100 api worker
docker compose -f infra/docker/docker-compose.prod.yml logs -f nginx   # inclui X-Cache-Status do HLS
```

- **Uptime**: suba um [Uptime Kuma](https://github.com/louislam/uptime-kuma) (um container) monitorando `http://192.168.0.100/healthz` a cada 60 s, com alerta via Telegram/e-mail.
- **Fila BullMQ**: `GET /api/v1/admin/jobs` (painel admin) mostra jobs ativos/falhos.
- **Disco**: cache HLS do nginx é limitado a 5 GB (`max_size` no `nginx.conf`); `docker system df` mostra o consumo de imagens/volumes.

## 11. Alternativa bare-metal (PM2)

Sem Docker para o app (Postgres/Redis ainda precisam existir — nativos ou via compose):

```bash
cd /opt/aurial
pnpm install --frozen-lockfile
pnpm --filter @aurial/shared build && pnpm --filter @aurial/api build
cp .env.example apps/api/.env   # valores de produção (hosts localhost neste modo)
pm2 start infra/pm2/ecosystem.config.cjs
pm2 save && pm2 startup
pm2 install pm2-logrotate       # obrigatório — PM2 não rotaciona logs sozinho
```

Processos: `aurial-api` (`dist/main.js`) e `aurial-worker` (`dist/workers/index.js`), ambos com `--env-file=.env`, `max_memory_restart` e backoff. Detalhes e notas no próprio `ecosystem.config.cjs`. Escolha **um** caminho (Docker _ou_ PM2) — não os dois.

## 12. Troubleshooting

| Sintoma                                          | Causa provável / correção                                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission denied ... docker.sock`              | usuário fora do grupo docker — relogue após o `setup-server.sh` (ou `newgrp docker`)                                                                                        |
| `error: /opt/aurial/.env not found` no deploy    | seção 4 — `cp .env.example .env` e preencha                                                                                                                                 |
| `bash\r: bad interpreter` ao rodar `*.sh`        | script chegou com CRLF — `infra/.gitattributes` força LF; corrija clones antigos com `git checkout -- infra/` ou `sed -i 's/\r$//' infra/scripts/*.sh`                      |
| API nunca fica healthy no deploy                 | `docker compose ... logs --tail 100 api` — causas comuns: `DATABASE_URL` apontando para `localhost` (deve ser `postgres`), credenciais Firebase inválidas, migration falhou |
| `migrate` falha com P1001 (can't reach database) | postgres ainda subindo — rode o deploy de novo; o healthcheck do compose normalmente previne isso                                                                           |
| 429 em rajadas de requisições                    | rate limit do nginx (20 r/s, burst 40) ou os limites da própria API — esperado; ajuste `limit_req` no `nginx.conf` se necessário                                            |
| WebSocket não conecta (listen-together)          | confirme `VITE_WS_URL` sem path (socket.io usa `/ws`), e que o acesso passa pelo nginx ou pela porta 4000 na LAN                                                            |
| Site Vercel não chama a API                      | mixed content (seção 6) ou `WEB_ORIGIN` errado no `.env` do servidor (CORS)                                                                                                 |
| Porta 80/443/4000 já em uso                      | `sudo ss -ltnp                                                                                                                                                              | grep -E ':80 | :443 | :4000'` — pare o serviço conflitante (apache/nginx nativo) |
| Upload grande falha em ~1 min                    | `proxy_read_timeout`/`client_max_body_size` no `nginx.conf` (512m padrão) — aumente se enviar arquivos maiores                                                              |
| Disco cheio                                      | `docker system prune -f` (o deploy já faz prune de imagens), confira `/opt/aurial/backups` e o volume `media-cache`                                                         |
