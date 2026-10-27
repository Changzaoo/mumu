#!/usr/bin/env bash
# Publica a API do radinho no vnmax SEM Docker (docs/vnmax-equilibrio.md, passo 4),
# rodando NESTE PC (Git Bash):
#   bash infra/scripts/publicar-api-vnmax.sh            # build + envio + troca
#   ESTAGIAR=1 bash infra/scripts/publicar-api-vnmax.sh # só deixa pronto em <dir>.novo
#
# O vnmax (Celeron, 3,4 GB) não compila nada: aqui se exporta a main limpa
# (git archive, sem o que as outras sessões têm pendente no checkout), instala,
# builda shared + api e gera com `pnpm deploy` uma pasta autossuficiente (com o
# prisma CLI dentro, para `prisma generate` e `migrate deploy` no servidor).
# Lá: tar na pasta .novo → prisma generate → (se as unidades estiverem ativas)
# migrate deploy → troca atômica → restart de radinho-api e radinho-worker.
#
# Unidades: infra/systemd/radinho-api.service e radinho-worker.service.
# Env no servidor: /home/v/radinho-api.env (DATABASE_URL/REDIS_URL nativos,
# PORT=4000, GIT_SHA é escrito pelo script). Nunca no git.
set -euo pipefail

HOST_SSH="${RADINHO_SSH:-v@100.103.150.56}"
DESTINO="${RADINHO_API_DIR:-/home/v/radinho-api}"
REF="${REF:-origin/main}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

passo() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

passo "1/5 exportando ${REF} limpa"
git fetch -q origin main
SHA="$(git rev-parse --short "$REF")"
EXPORT="$(mktemp -d "${TMPDIR:-/tmp}/radinho-api-build.XXXXXX")"
trap 'rm -rf "$EXPORT"' EXIT
git archive "$REF" | tar -x -C "$EXPORT"
echo "commit ${SHA} em ${EXPORT}"

passo "2/5 instalando e buildando (shared + api) — ${SHA}"
cd "$EXPORT"
pnpm install --frozen-lockfile --prefer-offline --filter "@radinho/api..." >/dev/null
pnpm --filter @radinho/shared build >/dev/null
pnpm --filter @radinho/api build >/dev/null
echo "dist: $(ls apps/api/dist | wc -l) entradas"

passo "3/5 pasta autossuficiente (pnpm deploy)"
SAIDA="$EXPORT/_deploy"
# node-linker=hoisted: node_modules com diretórios de verdade. Com o linker padrão
# o pnpm cria junções no Windows e o tar as deixa para trás (faltou @prisma/client
# no servidor na primeira tentativa, 27/10/2026).
pnpm --filter @radinho/api deploy --legacy --config.node-linker=hoisted "$SAIDA" >/dev/null
# O prisma generate roda no servidor (engine do Linux); aqui só conferimos o CLI e o cliente.
[[ -x "$SAIDA/node_modules/.bin/prisma" ]] || { echo "prisma CLI ausente na pasta" >&2; exit 1; }
[[ -d "$SAIDA/node_modules/@prisma/client" ]] || { echo "@prisma/client ausente na pasta (links?)" >&2; exit 1; }
find "$SAIDA/node_modules" -maxdepth 1 -type l | grep -q . && { echo "node_modules ainda tem links; o tar os perderia" >&2; exit 1; }
echo "$SHA" > "$SAIDA/VERSAO"
du -sh "$SAIDA" | cut -f1

passo "4/5 enviando para ${HOST_SSH}:${DESTINO}.novo"
ssh -o BatchMode=yes "$HOST_SSH" "rm -rf '${DESTINO}.novo' && mkdir -p '${DESTINO}.novo'"
tar -C "$SAIDA" -cf - . | ssh -o BatchMode=yes "$HOST_SSH" "tar -C '${DESTINO}.novo' -xf -"

passo "5/5 no servidor: prisma generate$( [[ "${ESTAGIAR:-0}" == "1" ]] && echo ' (só estagiar)' )"
ssh -o BatchMode=yes "$HOST_SSH" bash -s -- "$DESTINO" "$SHA" "${ESTAGIAR:-0}" <<'REMOTO'
set -euo pipefail
DESTINO="$1"; SHA="$2"; ESTAGIAR="$3"
cd "${DESTINO}.novo"
if ! saida="$(nice -n 10 ./node_modules/.bin/prisma generate 2>&1)"; then echo "$saida" | tail -5 >&2; exit 1; fi
echo "prisma generate ok"
node -e 'import("@prisma/client").then(() => console.log("@prisma/client carrega"))'
if [[ "$ESTAGIAR" == "1" ]]; then
  echo "estagiado em ${DESTINO}.novo (${SHA}); nada ativado."
  exit 0
fi
[[ -f /home/v/radinho-api.env ]] || { echo "falta /home/v/radinho-api.env" >&2; exit 1; }
ativa=0; systemctl --user is-active radinho-api.service >/dev/null 2>&1 && ativa=1
if [[ "$ativa" == 1 ]]; then
  set -a; . /home/v/radinho-api.env; set +a
  ./node_modules/.bin/prisma migrate deploy
fi
cd /home/v
rm -rf "${DESTINO}.velho"; [[ -d "$DESTINO" ]] && mv "$DESTINO" "${DESTINO}.velho"
mv "${DESTINO}.novo" "$DESTINO"
sed -i "s/^GIT_SHA=.*/GIT_SHA=${SHA}/" /home/v/radinho-api.env; grep -q "^GIT_SHA=" /home/v/radinho-api.env || echo "GIT_SHA=${SHA}" >> /home/v/radinho-api.env
if [[ "$ativa" == 1 ]]; then
  systemctl --user restart radinho-api.service radinho-worker.service
  for i in $(seq 1 20); do
    b="$(curl -fsS --max-time 3 http://127.0.0.1:4000/healthz 2>/dev/null || true)"
    [[ "$b" == *"\"version\":\"${SHA}\""* ]] && { echo "API no ar em ${SHA}"; rm -rf "${DESTINO}.velho"; exit 0; }
    sleep 3
  done
  echo "API nao respondeu ${SHA} em :4000 — journalctl --user -u radinho-api -n 50" >&2; exit 1
fi
echo "pasta trocada (${SHA}); unidades ainda desativadas (passo 3 do vnmax-equilibrio pendente)."
REMOTO
