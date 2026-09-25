#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# radinho.online — build & deploy the API stack (docker compose) on the server.
#
# Run ON the server:
#   cd /opt/aurial && ./infra/scripts/deploy-api.sh
# or remotely (what deploy-from-windows.ps1 and the GitHub workflow do):
#   ssh v@192.168.0.100 "cd /opt/aurial && ./infra/scripts/deploy-api.sh"
#
# Steps: fetch + fast-forward origin/main → build images → run migrations → up -d → health check
# → prune dangling images. Fails fast; prints a rollback hint on failure.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker/docker-compose.prod.yml"
# API healthcheck — direct on the published port (nginx also proxies it).
HEALTH_URL="${HEALTH_URL:-http://localhost:4000/healthz}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
# Importador (yt-dlp + cofre) roda fora do docker, como serviço systemd de
# usuário. Sem reiniciá-lo, um `git pull` trocava os arquivos mas o processo
# seguia servindo o código antigo indefinidamente.
IMPORTER_UNIT="${IMPORTER_UNIT:-radinho-importer}"
IMPORTER_HEALTH_URL="${IMPORTER_HEALTH_URL:-http://127.0.0.1:8787/health}"
STATE_DIR="${REPO_ROOT}/.deploy"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

cd "${REPO_ROOT}"

step "0/7 Preflight"
if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  echo "error: ${REPO_ROOT}/.env not found." >&2
  echo "       cp .env.example .env  and fill in production values (docs/DEPLOY.md §3)." >&2
  exit 1
fi
docker compose version >/dev/null

step "1/6 Update sources (${DEPLOY_BRANCH})"
if [[ -d .git ]]; then
  PREV_SHA="$(git rev-parse --short HEAD)"
  # `git pull --ff-only` sozinho falhava (e o servidor ficava em código velho)
  # quando o checkout estava em HEAD destacado — exatamente o estado que o
  # rollback abaixo deixa — ou em outro branch. Aqui: fetch explícito, volta
  # ao branch de deploy e só avança em fast-forward.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "error: arquivos rastreados alterados direto no servidor:" >&2
    git status --short --untracked-files=no >&2
    echo "       commite no repo (ou 'git stash') antes de publicar — o deploy nao sobrescreve." >&2
    exit 1
  fi
  git fetch --prune origin "${DEPLOY_BRANCH}"
  if [[ "$(git symbolic-ref --short -q HEAD || true)" != "${DEPLOY_BRANCH}" ]]; then
    echo "checkout estava em '$(git symbolic-ref --short -q HEAD || echo "HEAD destacado")' — voltando para ${DEPLOY_BRANCH}."
    git checkout "${DEPLOY_BRANCH}"
  fi
  if ! git merge --ff-only "origin/${DEPLOY_BRANCH}"; then
    echo "error: ${DEPLOY_BRANCH} local divergiu de origin/${DEPLOY_BRANCH} (commits feitos no servidor?)." >&2
    echo "       git log --oneline origin/${DEPLOY_BRANCH}..HEAD  mostra o que so existe aqui." >&2
    exit 1
  fi
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/${DEPLOY_BRANCH}")" ]]; then
    echo "error: HEAD nao bate com origin/${DEPLOY_BRANCH} depois do fetch." >&2
    exit 1
  fi
  GIT_SHA="$(git rev-parse --short HEAD)"
  echo "now at ${GIT_SHA} (was ${PREV_SHA})"
else
  PREV_SHA="(not a git checkout)"
  GIT_SHA="unknown"
  echo "warning: ${REPO_ROOT} nao e um checkout git — publicando os arquivos como estao." >&2
  # rsync fallback: push the tree from the dev machine instead, e.g.
  #   rsync -az --delete --exclude node_modules --exclude .env \
  #     ./ v@192.168.0.100:/opt/aurial/
fi
export GIT_SHA

step "2/7 Build images (worker reuses aurial-api image tag)"
# Build only once: with classic builder, building api+worker in parallel can race
# while exporting the same `aurial-api:latest` tag.
compose build --pull api

step "3/7 Run database migrations (prisma migrate deploy)"
compose --profile tools run --rm migrate

step "4/7 Start the stack"
compose up -d --remove-orphans

step "5/7 Health check (${HEALTH_URL})"
healthy=0
for i in $(seq 1 "${HEALTH_RETRIES}"); do
  body="$(curl -fsS --max-time 3 "${HEALTH_URL}" 2>/dev/null || true)"
  if [[ -n "${body}" ]]; then
    # Container respondendo com outro commit = imagem velha ainda no ar.
    if [[ "${GIT_SHA}" == "unknown" || "${body}" == *"\"version\":\"${GIT_SHA}\""* ]]; then
      healthy=1
      echo "API healthy after ${i} attempt(s) (version ${GIT_SHA})."
      break
    fi
  fi
  printf '.'
  sleep 2
done
echo
if [[ "${healthy}" -ne 1 ]]; then
  cat >&2 <<ROLLBACK

error: API did not become healthy after $((HEALTH_RETRIES * 2))s.

Debug:
  docker compose -f infra/docker/docker-compose.prod.yml ps
  docker compose -f infra/docker/docker-compose.prod.yml logs --tail 100 api worker

Rollback to the previous version (was ${PREV_SHA}) — revert on main and push,
then deploy again (checking out an old SHA here is undone by the next deploy):
  git revert <bad-commit> && git push   # on the dev machine
  ./infra/scripts/deploy-api.sh
(Migrations are forward-only — if the failing release migrated the schema,
restore the latest dump from /opt/aurial/backups first. See docs/DEPLOY.md.)
ROLLBACK
  exit 1
fi

step "6/7 Importer (systemd --user ${IMPORTER_UNIT})"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if ! systemctl --user cat "${IMPORTER_UNIT}" >/dev/null 2>&1; then
  echo "unidade ${IMPORTER_UNIT} nao encontrada — pulando (IMPORTER_UNIT=... para outro nome)."
else
  # O serviço precisa rodar o server.mjs DESTE checkout; senão o git nunca chega nele.
  unit_cmd="$(systemctl --user show -p ExecStart -p WorkingDirectory "${IMPORTER_UNIT}")"
  if [[ "${unit_cmd}" != *"${REPO_ROOT}"* ]]; then
    echo "warning: ${IMPORTER_UNIT} nao aponta para ${REPO_ROOT} — ele NAO recebe o codigo do git:" >&2
    echo "${unit_cmd}" >&2
  fi
  last_importer="$(cat "${STATE_DIR}/importer.sha" 2>/dev/null || true)"
  if [[ "${GIT_SHA}" == "unknown" || -z "${last_importer}" ]] \
    || ! git cat-file -e "${last_importer}^{commit}" 2>/dev/null \
    || ! git diff --quiet "${last_importer}" HEAD -- apps/importer; then
    if [[ -n "${last_importer}" ]] && git cat-file -e "${last_importer}^{commit}" 2>/dev/null \
      && ! git diff --quiet "${last_importer}" HEAD -- apps/importer/package.json; then
      echo "dependencias do importador mudaram — pnpm install."
      if command -v pnpm >/dev/null; then
        pnpm install --frozen-lockfile --filter @radinho/importer
      else
        echo "warning: pnpm ausente — rode 'pnpm install --filter @radinho/importer' a mao." >&2
      fi
    fi
    systemctl --user restart "${IMPORTER_UNIT}"
    ok=0
    for _ in $(seq 1 15); do
      ibody="$(curl -fsS --max-time 3 "${IMPORTER_HEALTH_URL}" 2>/dev/null || true)"
      if [[ -n "${ibody}" ]]; then ok=1; break; fi
      sleep 2
    done
    if [[ "${ok}" -ne 1 ]]; then
      echo "error: importador nao respondeu em ${IMPORTER_HEALTH_URL} apos restart." >&2
      echo "       journalctl --user -u ${IMPORTER_UNIT} -n 100" >&2
      exit 1
    fi
    if [[ "${GIT_SHA}" != "unknown" && "${ibody}" != *"\"version\":\"${GIT_SHA}\""* ]]; then
      echo "warning: importador no ar nao reporta ${GIT_SHA}: ${ibody:0:200}" >&2
    fi
    mkdir -p "${STATE_DIR}" && echo "${GIT_SHA}" >"${STATE_DIR}/importer.sha"
    echo "importador reiniciado em ${GIT_SHA}."
  else
    echo "apps/importer sem mudancas desde ${last_importer} — sem restart."
  fi
fi
if [[ "${PREV_SHA}" != "${GIT_SHA}" ]] && git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null \
  && ! git diff --quiet "${PREV_SHA}" HEAD -- apps/signaling; then
  echo "warning: apps/signaling mudou — rebuild e restart manuais:" >&2
  echo "  pnpm --filter @radinho/signaling build && sudo systemctl restart radinho-signaling" >&2
fi

step "7/7 Prune dangling images"
docker image prune -f

printf '\n\033[1;32mDeploy complete.\033[0m\n'
compose ps
