#!/usr/bin/env bash
# vnmax — passo 3 (parte A, precisa de sudo; o Vinicius roda):
#   sudo bash /home/v/vnmax/passo3a-instalar-postgres-redis.sh
# Instala Postgres e Redis nativos (só em localhost), com memória contida, e cria
# o papel/banco "aurial" com a MESMA senha do /opt/aurial/.env. NÃO toca nos
# contêineres nem mexe nos dados: a troca é a parte B (passo3b, sem sudo).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "rode com sudo" >&2; exit 1; }
ENV=/opt/aurial/.env
[[ -f $ENV ]] || { echo "falta $ENV" >&2; exit 1; }
SENHA="$(grep -E '^DATABASE_URL=' "$ENV" | sed -E 's#^DATABASE_URL=postgresql://[^:]+:([^@]+)@.*#\1#')"
[[ -n "$SENHA" ]] || { echo "não achei a senha em DATABASE_URL" >&2; exit 1; }
echo "== antes"; free -m | sed -n 2,3p; df -h / | tail -1

echo "== instalando"
DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql redis-server
PGVER="$(ls /etc/postgresql | sort -n | tail -1)"
echo "postgres ${PGVER}"

echo "== postgres: localhost, memória pequena (3,4 GB divididos a três)"
cat > "/etc/postgresql/${PGVER}/main/conf.d/vnmax.conf" <<'EOF'
# vnmax, 27/10/2026 — docs/vnmax-equilibrio.md
listen_addresses = 'localhost'
max_connections = 40
shared_buffers = 128MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 512MB
wal_compression = on
EOF
systemctl restart postgresql
systemctl enable postgresql >/dev/null
sudo -u postgres psql -v ON_ERROR_STOP=1 -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aurial') THEN CREATE ROLE aurial LOGIN PASSWORD '${SENHA}'; END IF; END \$\$;"
sudo -u postgres psql -v ON_ERROR_STOP=1 -qc "ALTER ROLE aurial PASSWORD '${SENHA}';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='aurial'" | grep -q 1 \
  || sudo -u postgres createdb -O aurial aurial
sudo -u postgres psql -tAc "select version()" | cut -c1-40

echo "== redis: localhost, 64 MB"
sed -i -E 's/^#?\s*maxmemory .*/maxmemory 64mb/; s/^#?\s*maxmemory-policy .*/maxmemory-policy noeviction/' /etc/redis/redis.conf
grep -q "^maxmemory 64mb" /etc/redis/redis.conf || echo "maxmemory 64mb" >> /etc/redis/redis.conf
grep -q "^maxmemory-policy" /etc/redis/redis.conf || echo "maxmemory-policy noeviction" >> /etc/redis/redis.conf
sed -i -E 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf
systemctl restart redis-server
systemctl enable redis-server >/dev/null
redis-cli ping

echo "== permissões para o usuário v (restaurar e operar sem sudo)"
sudo -u postgres psql -qc "ALTER ROLE aurial CREATEDB;"
echo "== depois"; free -m | sed -n 2,3p; df -h / | tail -1
echo "pronto. Agora a parte B (sem sudo, feita pela sessão): passo3b-trocar-para-nativo.sh"
