#!/usr/bin/env bash
# vnmax — passo 2 do docs/vnmax-equilibrio.md (precisa de sudo; o Vinicius roda):
#   sudo bash /home/v/vnmax/passo2-zram.sh
# zram de 1,5 GB (zstd) com prioridade acima do /swap.img, que fica de reserva.
# Num Celeron com 3,4 GB, comprimir em RAM responde muito melhor que o eMMC.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "rode com sudo" >&2; exit 1; }
echo "== antes"; free -m | sed -n 2,3p; cat /proc/swaps

apt-get install -y zram-tools
cat > /etc/default/zramswap <<'EOF'
# vnmax, 27/10/2026: 1,5 GB comprimido com zstd, prioridade 100 (o /swap.img fica em -1)
ALGO=zstd
SIZE=1536
PRIORITY=100
EOF
systemctl restart zramswap.service
systemctl enable zramswap.service >/dev/null

cat > /etc/sysctl.d/90-vnmax-zram.conf <<'EOF'
# zram é RAM: pode trocar cedo e barato. Páginas de cache ficam.
vm.swappiness=100
vm.page-cluster=0
vm.vfs_cache_pressure=50
EOF
sysctl --system >/dev/null

echo "== depois"; cat /proc/swaps; free -m | sed -n 2,3p; sysctl vm.swappiness
