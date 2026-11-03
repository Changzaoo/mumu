# syntax=docker/dockerfile:1
# O IMPORTADOR DE RESERVA NA NUVEM (Render, plano grátis) — ver render.yaml.
#
# Contexto de build = apps/importer (o render.yaml aponta `dockerContext: ./apps/importer`):
# o .dockerignore da raiz exclui apps/importer de propósito (é o contexto da API).
# Sobe o mesmo server.mjs do importador, sem whisper local (TEMPO_LOCAL=0): o
# relógio da letra vem pré-computado pela borda do GitHub, e o que esta cópia
# faz é o que um navegador não consegue — busca no YouTube, /stream por yt-dlp,
# /blob para a sessão, /letra/outras-fontes, /ai/* — enquanto o importador
# principal (vnmax) está fora. O disco aqui é descartável: cofre pequeno, nada
# que precise sobreviver a um reinício.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 wget \
  && wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -O /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get purge -y wget && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
# Sem pnpm aqui de propósito (o importador não depende do workspace): npm resolve
# as três dependências diretas do package.json.
RUN npm install --omit=dev --no-audit --no-fund
COPY . ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin \
    PYTHON_PATH=/usr/bin/python3 \
    BLOB_DIR=/data/cofre \
    TEMPO_DIR=/data/tempos \
    JEV_DIR=/data/jev \
    TMPDIR=/data/work \
    TEMPO_LOCAL=0 \
    MAX_BLOB_GB=1 \
    MIN_FREE_MB=512 \
    COFRE_EXIGE_MARCADOR=0 \
    STREAM_CACHE_MB=96 \
    MAX_RESOLUCOES=1 \
    MAX_RECONSTRUCOES=1 \
    ALLOW_ORIGIN=* \
    IMPORT_REQUIRE_LOGIN=1 \
    YTDLP_PLAYER_CLIENT=web_embedded

RUN mkdir -p /data/cofre /data/tempos /data/jev /data/work
EXPOSE 10000
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
RUN chmod +x /app/docker-entrypoint.sh
CMD ["/app/docker-entrypoint.sh"]
