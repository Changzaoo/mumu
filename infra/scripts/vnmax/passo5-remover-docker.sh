#!/usr/bin/env bash
# vnmax — passo 5 do docs/vnmax-equilibrio.md (precisa de sudo; o Vinicius roda),
# SÓ depois de o passo 3b estar no ar há pelo menos um dia:
#   sudo bash /home/v/vnmax/passo5-remover-docker.sh
# Remove o Docker (daemon ~450 MB de RAM, ~11 GB de disco) e o cache de pacotes.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "rode com sudo" >&2; exit 1; }
curl -fsS --max-time 5 http://127.0.0.1:4000/healthz >/dev/null || { echo "API nativa não responde em :4000 — não remova o Docker" >&2; exit 1; }
echo "== antes"; free -m | sed -n 2,3p; df -h / | tail -1
systemctl disable --now docker.socket docker.service containerd.service
# Um por vez: um nome que não existe aborta o apt inteiro (aconteceu em 28/10/2026).
for p in docker.io docker-compose-v2 docker-buildx containerd runc docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin; do
  dpkg -s "$p" >/dev/null 2>&1 && { apt-get purge -y "$p" || echo "purge de $p falhou"; }
done
apt-get autoremove -y --purge
rm -rf /var/lib/docker /var/lib/containerd /opt/containerd
# Sobras de root no cartão (o resto já foi limpo como usuário v): docker antigo,
# banco de outra aplicação e um swapfile que não está em uso.
if findmnt -n /mnt/cartaosd >/dev/null; then
  swapon --show=NAME --noheadings | grep -q /mnt/cartaosd/swapfile || rm -f /mnt/cartaosd/swapfile
  rm -rf /mnt/cartaosd/docker /mnt/cartaosd/cortes-db
  ls -la /mnt/cartaosd
fi
rm -f /opt/six3-backup-*.tar.gz
journalctl --vacuum-size=100M
apt-get clean
echo "== depois"; free -m | sed -n 2,3p; df -h / | tail -1
