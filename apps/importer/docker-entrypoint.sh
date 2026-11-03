#!/bin/sh
# Entrada do contêiner do importador de reserva (Render). Materializa os
# segredos que só existem como variável de ambiente e sobe o servidor.
set -eu
mkdir -p /data/cofre /data/tempos /data/jev /data/work
if [ -n "${YTDLP_COOKIES_B64:-}" ]; then
  echo "$YTDLP_COOKIES_B64" | base64 -d > /data/cookies.txt
  export YTDLP_COOKIES=/data/cookies.txt
fi
exec node --max-old-space-size=384 server.mjs
