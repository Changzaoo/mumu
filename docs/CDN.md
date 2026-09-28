# CDN de áudio

Como o radinho aguenta muita gente ouvindo ao mesmo tempo sem engasgar — no
mesmo desenho do Spotify: **origem → bordas com cache → cliente escolhendo a
borda**.

```
            ┌───────────── PoP (docker-compose.cdn.yml) ─────────────┐
 app ──►    │  lb (hash consistente por faixa) ──► edge 1  (cache)   │ ──► importador (/blob, /stream)
 (escolhe   │                                  ──► edge 2  (cache)   │ ──► API (HLS /api/v1/stream)
  o PoP)    │                                  ──► edge N  (cache)   │
            └────────────────────────────────────────────────────────┘
```

## As três camadas

1. **Origem que não repete trabalho** (`apps/importer/transmissaoCompartilhada.mjs`)
   - `/stream` fazia um yt-dlp + ffmpeg **por ouvinte**. Agora é **um por
     faixa/qualidade**: quem chega depois se pendura no mesmo transcode e recebe
     o começo do buffer (request collapsing).
   - Faixa terminada fica na RAM (LRU, `STREAM_CACHE_MB`, padrão 256) por 30
     min: a música do momento sai da memória, sem processo nenhum.
   - O encode só morre quando o **último** ouvinte sai (folga de 5 s).
   - Contadores em `GET /health` → `transmissoes`.

2. **Bordas com cache** (`infra/cdn/edge`, `infra/cdn/lb`)
   - `/blob/<id>?k=` é guardado em **fatias de 1 MB** (`slice`): seek só busca
     a fatia, e a faixa fica em cache conforme é ouvida.
   - `proxy_cache_lock`: 100 pedidos da mesma fatia = **1** ida à origem.
   - `proxy_cache_use_stale`: origem fora do ar → a borda segue servindo o que
     já tem.
   - O `k` é da cópia (igual para todos), então entra na chave sem espalhar o
     cache; `k` errado é sempre miss e a origem responde 403.
   - O balanceador usa `hash $uri consistent`: cada faixa mora em um nó, o cache
     total do PoP é a **soma** dos discos, e um nó que cai só redistribui as
     faixas dele.
   - `/stream` passa pela borda sem cache (token por ouvinte) — a origem já
     junta os ouvintes.

3. **Cliente que escolhe a borda** (`apps/web/src/lib/audio/cdn.ts`)
   - `VITE_AUDIO_CDN=https://cdn1…,https://cdn2…` (PoPs). Vazio = origem direta.
   - Rendezvous hashing: a mesma faixa vai sempre ao mesmo PoP em todos os
     aparelhos (cache quente).
   - Failover: borda que falha fica fora por 60 s e o player tenta a próxima;
     a **origem é sempre o último candidato**. 404 de borda nunca apaga a cópia
     (`reportDeadRemote` só aceita a URL da origem).

## Subir um PoP

```bash
cat > infra/docker/.env <<'EOF'
ORIGIN_IMPORTER=https://importer.nexusholding.xyz
ORIGIN_API=http://host.docker.internal:4000
EDGE_CACHE_SIZE=20g
CDN_PORT=8088
EOF
docker compose -f infra/docker/docker-compose.cdn.yml up -d --scale edge=3
curl -I "http://localhost:8088/blob/<id>?k=<token>"   # X-Cache-Status: MISS → HIT
```

Mudou o número de réplicas? `docker compose -f infra/docker/docker-compose.cdn.yml restart lb`.

Exponha o PoP com TLS pelo proxy do host (Caddy):

```
cdn1.radinho.online {
    reverse_proxy 127.0.0.1:8088
}
```

Para escalar geograficamente, suba o mesmo compose em outras máquinas (VPS
perto dos ouvintes) e acrescente cada uma em `VITE_AUDIO_CDN`.

## Trade-offs conhecidos

- Segmentos HLS da API ficam em cache sem o token na chave (são imutáveis);
  quem tem a URL do segmento toca sem token — mesmo trade-off de
  `infra/nginx/nginx.conf`.
- O cache em RAM do `/stream` guarda a faixa só quando os processos saem
  limpos; transmissões cortadas servem quem já estava ouvindo e são descartadas.
