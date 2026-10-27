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
apt-get purge -y docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin docker.io containerd runc 2>/dev/null || true
apt-get autoremove -y --purge
rm -rf /var/lib/docker /var/lib/containerd /opt/containerd
journalctl --vacuum-size=100M
apt-get clean
echo "== depois"; free -m | sed -n 2,3p; df -h / | tail -1
