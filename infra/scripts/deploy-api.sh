#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Aurial — build & deploy the API stack (docker compose) on the server.
#
# Run ON the server:
#   cd /opt/aurial && ./infra/scripts/deploy-api.sh
# or remotely (what deploy-from-windows.ps1 and the GitHub workflow do):
#   ssh v@192.168.0.100 "cd /opt/aurial && ./infra/scripts/deploy-api.sh"
#
# Steps: git pull → build images → run migrations → up -d → health check
# → prune dangling images. Fails fast; prints a rollback hint on failure.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker/docker-compose.prod.yml"
# API healthcheck — direct on the published port (nginx also proxies it).
HEALTH_URL="${HEALTH_URL:-http://localhost:4000/healthz}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

cd "${REPO_ROOT}"

step "0/6 Preflight"
if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  echo "error: ${REPO_ROOT}/.env not found." >&2
  echo "       cp .env.example .env  and fill in production values (docs/DEPLOY.md §3)." >&2
  exit 1
fi
docker compose version >/dev/null

step "1/6 Update sources"
if [[ -d .git ]]; then
  PREV_SHA="$(git rev-parse --short HEAD)"
  git pull --ff-only
  echo "now at $(git rev-parse --short HEAD) (was ${PREV_SHA})"
else
  PREV_SHA="(not a git checkout)"
  echo "not a git checkout — skipping pull."
  # rsync fallback: push the tree from the dev machine instead, e.g.
  #   rsync -az --delete --exclude node_modules --exclude .env \
  #     ./ v@192.168.0.100:/opt/aurial/
fi

step "2/6 Build images (api + worker share the aurial-api image)"
compose build --pull api worker

step "3/6 Run database migrations (prisma migrate deploy)"
compose --profile tools run --rm migrate

step "4/6 Start the stack"
compose up -d --remove-orphans

step "5/6 Health check (${HEALTH_URL})"
healthy=0
for i in $(seq 1 "${HEALTH_RETRIES}"); do
  if curl -fsS --max-time 3 "${HEALTH_URL}" >/dev/null 2>&1; then
    healthy=1
    echo "API healthy after ${i} attempt(s)."
    break
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

Rollback to the previous version (was ${PREV_SHA}):
  git checkout ${PREV_SHA}
  ./infra/scripts/deploy-api.sh
(Migrations are forward-only — if the failing release migrated the schema,
restore the latest dump from /opt/aurial/backups first. See docs/DEPLOY.md.)
ROLLBACK
  exit 1
fi

step "6/6 Prune dangling images"
docker image prune -f

printf '\n\033[1;32mDeploy complete.\033[0m\n'
compose ps
