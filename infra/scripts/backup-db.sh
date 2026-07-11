#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Aurial — PostgreSQL backup (pg_dump from the postgres container).
#
# Run ON the server:
#   /opt/aurial/infra/scripts/backup-db.sh
#
# Writes gzipped dumps to /opt/aurial/backups (BACKUP_DIR to override)
# and keeps the newest 14 (KEEP to override).
#
# Cron (daily at 03:00) — crontab -e as the deploy user:
#   0 3 * * * /opt/aurial/infra/scripts/backup-db.sh >> /opt/aurial/backups/backup.log 2>&1
#
# Restore example:
#   gunzip -c /opt/aurial/backups/aurial-YYYYMMDD-HHMMSS.sql.gz | \
#     docker compose -f /opt/aurial/infra/docker/docker-compose.prod.yml \
#       exec -T postgres psql -U aurial -d aurial
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker/docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-/opt/aurial/backups}"
KEEP="${KEEP:-14}"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

step "1/3 Dump database"
mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/aurial-${STAMP}.sql.gz"

docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U aurial -d aurial --no-owner --clean --if-exists | gzip >"${FILE}"

# gzip of an empty stream is ~20 bytes — treat tiny files as failure.
SIZE="$(stat -c%s "${FILE}")"
if [[ "${SIZE}" -lt 1024 ]]; then
  echo "error: dump looks empty (${SIZE} bytes) — is the postgres container up?" >&2
  rm -f -- "${FILE}"
  exit 1
fi
echo "wrote ${FILE} (${SIZE} bytes)"

step "2/3 Prune old backups (keep newest ${KEEP})"
mapfile -t OLD < <(ls -1t "${BACKUP_DIR}"/aurial-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))")
if [[ "${#OLD[@]}" -gt 0 ]]; then
  rm -f -- "${OLD[@]}"
  printf 'removed %d old backup(s)\n' "${#OLD[@]}"
else
  echo "nothing to prune"
fi

step "3/3 Current backups"
ls -lh "${BACKUP_DIR}"/aurial-*.sql.gz
