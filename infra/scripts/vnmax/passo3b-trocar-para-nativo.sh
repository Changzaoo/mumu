#!/usr/bin/env bash
# vnmax — passo 3 (parte B, SEM sudo; a sessão roda como v):
#   bash /home/v/vnmax/passo3b-trocar-para-nativo.sh
# Troca o radinho dos contêineres para Postgres/Redis nativos + API e worker em
# systemd --user (passos 3 e 4 juntos: a API nova só existe fora do Docker).
# Pré-requisitos: passo3a feito; /home/v/radinho-api publicado (publicar-api-vnmax.sh);
# unidades radinho-api/radinho-worker instaladas; /home/v/radinho-api.env existente.
# Indisponibilidade: do stop dos contêineres até a API nova responder (minutos).
# Rollback automático se a API nova não responder: sobe os contêineres de volta.
set -euo pipefail
ENV=/home/v/radinho-api.env
COMPOSE="docker compose -f /opt/aurial/infra/docker/docker-compose.prod.yml"
SENHA="$(grep -E '^DATABASE_URL=' /opt/aurial/.env | sed -E 's#^DATABASE_URL=postgresql://[^:]+:([^@]+)@.*#\1#')"
export PGPASSWORD="$SENHA"
[[ -d /home/v/radinho-api/dist ]] || { echo "falta /home/v/radinho-api (publicar-api-vnmax.sh)" >&2; exit 1; }
psql -h localhost -U aurial -d aurial -tAc "select 1" >/dev/null || { echo "postgres nativo não responde (passo3a)" >&2; exit 1; }
redis-cli -h 127.0.0.1 ping >/dev/null || { echo "redis nativo não responde (passo3a)" >&2; exit 1; }
echo "== antes"; free -m | sed -n 2,3p; date +%T

echo "== 1. para a API e o worker (os dados param de mudar)"
$COMPOSE stop api worker

echo "== 2. dump fresco do Postgres do contêiner"
d=$(date +%Y%m%d-%H%M); f=/home/v/backups/aurial-$d-troca.dump
docker exec aurial-postgres-1 pg_dump -U aurial -Fc aurial > "$f"; ls -la "$f"

echo "== 3. restaura no nativo (banco limpo)"
psql -h localhost -U aurial -d postgres -qc "DROP DATABASE IF EXISTS aurial_nova"
psql -h localhost -U aurial -d postgres -qc "CREATE DATABASE aurial_nova OWNER aurial"
pg_restore -h localhost -U aurial -d aurial_nova --no-owner --role=aurial "$f"
orig=$(docker exec aurial-postgres-1 psql -U aurial -d aurial -tAc 'select count(*) from "CatalogTrack"')
novo=$(psql -h localhost -U aurial -d aurial_nova -tAc 'select count(*) from "CatalogTrack"')
echo "CatalogTrack contêiner=$orig nativo=$novo"
[[ "$orig" == "$novo" ]] || { echo "contagem diferente — abortando e religando os contêineres" >&2; $COMPOSE start api worker; exit 1; }
psql -h localhost -U aurial -d postgres -qc "DROP DATABASE IF EXISTS aurial"
psql -h localhost -U aurial -d postgres -qc "ALTER DATABASE aurial_nova RENAME TO aurial"

echo "== 4. env nativo"
sed -i -E "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://aurial:${SENHA}@localhost:5432/aurial?schema=public#; s#^REDIS_URL=.*#REDIS_URL=redis://127.0.0.1:6379#" "$ENV"
grep -E "^(DATABASE_URL|REDIS_URL)=" "$ENV" | sed -E "s#(://[^:]+:)[^@]+@#\1<senha>@#"

echo "== 5. migrations pendentes (nenhuma esperada) e sobe API + worker nativos"
( cd /home/v/radinho-api && set -a && . "$ENV" && set +a && ./node_modules/.bin/prisma migrate deploy | tail -2 )
$COMPOSE stop postgres redis
systemctl --user enable --now radinho-api.service radinho-worker.service
sha="$(cat /home/v/radinho-api/VERSAO 2>/dev/null || echo ?)"
ok=0
for i in $(seq 1 30); do
  b="$(curl -fsS --max-time 3 http://127.0.0.1:4000/healthz 2>/dev/null || true)"
  [[ -n "$b" ]] && { ok=1; echo "healthz: $b"; break; }
  sleep 3
done
if [[ "$ok" != 1 ]]; then
  echo "API nativa não respondeu — ROLLBACK para os contêineres" >&2
  systemctl --user disable --now radinho-api.service radinho-worker.service || true
  $COMPOSE start postgres redis api worker
  exit 1
fi
echo "== depois"; free -m | sed -n 2,3p; date +%T
echo "contêineres parados (não removidos). Passo 5 (remover Docker) só depois de um dia de observação."
